#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct NativeWasapiInitResult {
    pub ok: bool,
    pub buffer_size_frames: Option<u32>,
    pub actual_sample_rate: Option<u32>,
    pub actual_bit_depth: Option<u32>,
    pub error: Option<String>,
}

#[napi(object)]
pub struct NativeAudioDevice {
    pub id: String,
    pub label: String,
    pub is_default: bool,
    pub is_virtual: bool,
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::*;

    pub fn is_supported() -> bool {
        false
    }

    pub fn init(
        _device_id: Option<String>,
        _sample_rate: u32,
        _channels: u16,
        _bit_depth: u16,
        _buffer_ms: u32,
    ) -> NativeWasapiInitResult {
        NativeWasapiInitResult {
            ok: false,
            buffer_size_frames: None,
            actual_sample_rate: None,
            actual_bit_depth: None,
            error: Some("WASAPI exclusive mode is only available on Windows".to_string()),
        }
    }

    pub fn write(_pcm: &[f32]) -> u32 {
        0
    }

    pub fn stop() {}

    pub fn get_devices() -> Vec<NativeAudioDevice> {
        Vec::new()
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::JoinHandle;
    // `SPEAKER_*` and `WAVE_FORMAT_EXTENSIBLE` live in KernelStreaming (ksmedia.h),
    // not in Media::Audio — they need the `Win32_Media_KernelStreaming` feature.
    use windows::core::{GUID, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::Media::KernelStreaming::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

    const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
        GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    struct ActiveState {
        stop_flag: Arc<AtomicBool>,
        event_handle: usize,
        render_thread: Option<JoinHandle<()>>,
        producer: rtrb::Producer<f32>,
        audio_client: IAudioClient,
    }

    // Safety: COM pointers and handles are managed on the dedicated audio thread
    unsafe impl Send for ActiveState {}

    /// COM wrappers are `!Send` because COM has no cross-apartment guarantee;
    /// this wrapper moves the render client to — and it is only ever used on —
    /// the dedicated render thread, which initializes its own MTA apartment
    /// first. The thread consumes it via `into_inner()`: a method call moves
    /// the *whole* wrapper into the closure, whereas a field access or
    /// destructure would let precise closure captures (RFC 2229) grab the raw
    /// interface and bypass this `Send` again.
    struct SendRenderClient(IAudioRenderClient);
    unsafe impl Send for SendRenderClient {}

    impl SendRenderClient {
        fn into_inner(self) -> IAudioRenderClient {
            self.0
        }
    }

    static STATE: Mutex<Option<ActiveState>> = Mutex::new(None);

    pub fn is_supported() -> bool {
        true
    }

    pub fn init(
        device_id: Option<String>,
        sample_rate: u32,
        channels: u16,
        bit_depth: u16,
        buffer_ms: u32,
    ) -> NativeWasapiInitResult {
        stop();

        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            // Annotated with the full path: a bare `Result<_, _>` would infer the
            // glob-imported `napi::Error` instead of the windows one.
            let enumerator: windows::core::Result<IMMDeviceEnumerator> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            let enumerator = match enumerator {
                Ok(e) => e,
                Err(err) => {
                    return NativeWasapiInitResult {
                        ok: false,
                        buffer_size_frames: None,
                        actual_sample_rate: None,
                        actual_bit_depth: None,
                        error: Some(format!("Failed to create MMDeviceEnumerator: {:?}", err)),
                    }
                }
            };

            let device = if let Some(id_str) = device_id {
                let wide: Vec<u16> = id_str.encode_utf16().chain(std::iter::once(0)).collect();
                enumerator.GetDevice(PCWSTR(wide.as_ptr()))
            } else {
                enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            };

            let device = match device {
                Ok(d) => d,
                Err(err) => {
                    return NativeWasapiInitResult {
                        ok: false,
                        buffer_size_frames: None,
                        actual_sample_rate: None,
                        actual_bit_depth: None,
                        error: Some(format!("Failed to get IMMDevice endpoint: {:?}", err)),
                    }
                }
            };

            let audio_client: windows::core::Result<IAudioClient> =
                device.Activate(CLSCTX_ALL, None);
            let audio_client = match audio_client {
                Ok(c) => c,
                Err(err) => {
                    return NativeWasapiInitResult {
                        ok: false,
                        buffer_size_frames: None,
                        actual_sample_rate: None,
                        actual_bit_depth: None,
                        error: Some(format!("Failed to activate IAudioClient: {:?}", err)),
                    }
                }
            };

            let use_float = bit_depth == 32;
            let target_bit_depth = if bit_depth == 24 {
                24
            } else if bit_depth == 32 {
                32
            } else {
                16
            };
            let container_bits = if target_bit_depth == 24 {
                32
            } else {
                target_bit_depth
            };

            let block_align = channels * (container_bits / 8);
            let avg_bytes_per_sec = sample_rate * block_align as u32;

            let sub_format = if use_float {
                KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
            } else {
                KSDATAFORMAT_SUBTYPE_PCM
            };

            let wave_format_ext = WAVEFORMATEXTENSIBLE {
                Format: WAVEFORMATEX {
                    wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
                    nChannels: channels,
                    nSamplesPerSec: sample_rate,
                    nAvgBytesPerSec: avg_bytes_per_sec,
                    nBlockAlign: block_align,
                    wBitsPerSample: container_bits,
                    cbSize: 22,
                },
                Samples: WAVEFORMATEXTENSIBLE_0 {
                    wValidBitsPerSample: target_bit_depth,
                },
                dwChannelMask: match channels {
                    1 => SPEAKER_FRONT_CENTER,
                    2 => SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT,
                    6 => {
                        SPEAKER_FRONT_LEFT
                            | SPEAKER_FRONT_RIGHT
                            | SPEAKER_FRONT_CENTER
                            | SPEAKER_LOW_FREQUENCY
                            | SPEAKER_BACK_LEFT
                            | SPEAKER_BACK_RIGHT
                    }
                    8 => {
                        SPEAKER_FRONT_LEFT
                            | SPEAKER_FRONT_RIGHT
                            | SPEAKER_FRONT_CENTER
                            | SPEAKER_LOW_FREQUENCY
                            | SPEAKER_BACK_LEFT
                            | SPEAKER_BACK_RIGHT
                            | SPEAKER_SIDE_LEFT
                            | SPEAKER_SIDE_RIGHT
                    }
                    _ => 0,
                },
                SubFormat: sub_format,
            };

            let p_format = &wave_format_ext as *const _ as *const WAVEFORMATEX;

            // Check format support
            let format_check =
                audio_client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, p_format, None);
            if format_check != S_OK {
                return NativeWasapiInitResult {
                    ok: false,
                    buffer_size_frames: None,
                    actual_sample_rate: None,
                    actual_bit_depth: None,
                    error: Some(format!(
                        "WASAPI Exclusive does not support format: {}Hz, {}ch, {}-bit (hr=0x{:X})",
                        sample_rate, channels, target_bit_depth, format_check.0
                    )),
                };
            }

            let mut audio_client = audio_client;
            let buffer_duration_hns = (buffer_ms as i64) * 10_000;
            let mut init_res = audio_client.Initialize(
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                buffer_duration_hns,
                buffer_duration_hns,
                p_format,
                None,
            );

            // Alignment dance: Handle AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED (0x88890019).
            // The retry activates a fresh client and re-initializes with the aligned
            // duration; the old client is only dropped once the retry has succeeded,
            // so `audio_client` is never conditionally moved out.
            const AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED: windows::core::HRESULT =
                windows::core::HRESULT(0x88890019_u32 as i32);

            if let Err(ref err) = init_res {
                if err.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                    if let Ok(aligned_frames) = audio_client.GetBufferSize() {
                        let aligned_duration_hns = ((10_000_000.0 * aligned_frames as f64)
                            / sample_rate as f64
                            + 0.5) as i64;
                        if let Ok(retry_client) = device.Activate::<IAudioClient>(CLSCTX_ALL, None)
                        {
                            let retry = retry_client.Initialize(
                                AUDCLNT_SHAREMODE_EXCLUSIVE,
                                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                aligned_duration_hns,
                                aligned_duration_hns,
                                p_format,
                                None,
                            );
                            if retry.is_ok() {
                                drop(audio_client);
                                audio_client = retry_client;
                                init_res = retry;
                            }
                        }
                    }
                }
            }

            if let Err(err) = init_res {
                return NativeWasapiInitResult {
                    ok: false,
                    buffer_size_frames: None,
                    actual_sample_rate: None,
                    actual_bit_depth: None,
                    error: Some(format!(
                        "Failed to initialize IAudioClient in exclusive mode: {:?}",
                        err
                    )),
                };
            }

            let event_handle = CreateEventW(None, false, false, None);
            let event_handle = match event_handle {
                Ok(h) => h,
                Err(err) => {
                    return NativeWasapiInitResult {
                        ok: false,
                        buffer_size_frames: None,
                        actual_sample_rate: None,
                        actual_bit_depth: None,
                        error: Some(format!("CreateEventW failed: {:?}", err)),
                    }
                }
            };

            if let Err(err) = audio_client.SetEventHandle(event_handle) {
                let _ = CloseHandle(event_handle);
                return NativeWasapiInitResult {
                    ok: false,
                    buffer_size_frames: None,
                    actual_sample_rate: None,
                    actual_bit_depth: None,
                    error: Some(format!("SetEventHandle failed: {:?}", err)),
                };
            }

            let buffer_size_frames = match audio_client.GetBufferSize() {
                Ok(f) => f,
                Err(err) => {
                    let _ = CloseHandle(event_handle);
                    return NativeWasapiInitResult {
                        ok: false,
                        buffer_size_frames: None,
                        actual_sample_rate: None,
                        actual_bit_depth: None,
                        error: Some(format!("Failed to get buffer size: {:?}", err)),
                    };
                }
            };

            // Create lock-free SPSC ring buffer (e.g. 200ms capacity)
            let ring_capacity = (sample_rate as usize * channels as usize * 200) / 1000;
            let (producer, mut consumer) = rtrb::RingBuffer::<f32>::new(ring_capacity);

            let render_client: IAudioRenderClient = match audio_client.GetService() {
                Ok(r) => r,
                Err(err) => {
                    let _ = CloseHandle(event_handle);
                    return NativeWasapiInitResult {
                        ok: false,
                        buffer_size_frames: None,
                        actual_sample_rate: None,
                        actual_bit_depth: None,
                        error: Some(format!("Failed to get IAudioRenderClient: {:?}", err)),
                    };
                }
            };

            // Pre-fill buffer with silence before starting stream (MSDN requirement for event-driven exclusive mode)
            if let Ok(dest_buf) = render_client.GetBuffer(buffer_size_frames) {
                let total_bytes = (buffer_size_frames as usize) * (block_align as usize);
                std::ptr::write_bytes(dest_buf, 0, total_bytes);
                let _ = render_client
                    .ReleaseBuffer(buffer_size_frames, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32);
            }

            let stop_flag = Arc::new(AtomicBool::new(false));
            let stop_thread = Arc::clone(&stop_flag);
            let raw_event = event_handle.0 as usize;

            if let Err(err) = audio_client.Start() {
                let _ = CloseHandle(event_handle);
                return NativeWasapiInitResult {
                    ok: false,
                    buffer_size_frames: None,
                    actual_sample_rate: None,
                    actual_bit_depth: None,
                    error: Some(format!("IAudioClient::Start failed: {:?}", err)),
                };
            }

            // See `SendRenderClient`: whole-value wrap for the thread move.
            let render_client = SendRenderClient(render_client);

            let render_thread = std::thread::spawn(move || {
                let render_client = render_client.into_inner();
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let h_event = HANDLE(raw_event as _);
                let frames_needed = buffer_size_frames;
                let samples_needed = (frames_needed as usize) * (channels as usize);

                while !stop_thread.load(Ordering::Relaxed) {
                    let wait_res = WaitForSingleObject(h_event, 1000);
                    if wait_res.0 != 0 || stop_thread.load(Ordering::Relaxed) {
                        break;
                    }

                    let dest_buffer = match render_client.GetBuffer(frames_needed) {
                        Ok(p) => p,
                        Err(_) => continue,
                    };

                    let mut underrun_samples = 0;
                    if target_bit_depth == 16 {
                        let out_slice =
                            std::slice::from_raw_parts_mut(dest_buffer as *mut i16, samples_needed);
                        for s in out_slice.iter_mut() {
                            if let Ok(val) = consumer.pop() {
                                let clamped = val.clamp(-1.0, 1.0);
                                *s = (clamped * 32767.0) as i16;
                            } else {
                                *s = 0;
                                underrun_samples += 1;
                            }
                        }
                    } else if target_bit_depth == 24 {
                        let out_slice =
                            std::slice::from_raw_parts_mut(dest_buffer as *mut i32, samples_needed);
                        for s in out_slice.iter_mut() {
                            if let Ok(val) = consumer.pop() {
                                let clamped = val.clamp(-1.0, 1.0);
                                *s = ((clamped * 8388607.0) as i32) << 8;
                            } else {
                                *s = 0;
                                underrun_samples += 1;
                            }
                        }
                    } else {
                        let out_slice =
                            std::slice::from_raw_parts_mut(dest_buffer as *mut f32, samples_needed);
                        for s in out_slice.iter_mut() {
                            if let Ok(val) = consumer.pop() {
                                *s = val.clamp(-1.0, 1.0);
                            } else {
                                *s = 0.0;
                                underrun_samples += 1;
                            }
                        }
                    }

                    let release_flags = if underrun_samples == samples_needed {
                        AUDCLNT_BUFFERFLAGS_SILENT.0 as u32
                    } else {
                        0
                    };

                    let _ = render_client.ReleaseBuffer(frames_needed, release_flags);
                }

                CoUninitialize();
            });

            let mut lock = STATE.lock().unwrap();
            *lock = Some(ActiveState {
                stop_flag,
                event_handle: raw_event,
                render_thread: Some(render_thread),
                producer,
                audio_client,
            });

            NativeWasapiInitResult {
                ok: true,
                buffer_size_frames: Some(buffer_size_frames),
                actual_sample_rate: Some(sample_rate),
                actual_bit_depth: Some(target_bit_depth as u32),
                error: None,
            }
        }
    }

    pub fn write(pcm: &[f32]) -> u32 {
        let mut lock = STATE.lock().unwrap();
        if let Some(state) = lock.as_mut() {
            let mut written = 0;
            for &sample in pcm {
                if state.producer.push(sample).is_ok() {
                    written += 1;
                } else {
                    break;
                }
            }
            written
        } else {
            0
        }
    }

    pub fn stop() {
        let mut lock = STATE.lock().unwrap();
        if let Some(mut state) = lock.take() {
            state.stop_flag.store(true, Ordering::SeqCst);
            unsafe {
                let h_event = HANDLE(state.event_handle as _);
                let _ = state.audio_client.Stop();
                let _ = SetEvent(h_event);
                if let Some(handle) = state.render_thread.take() {
                    let _ = handle.join();
                }
                let _ = CloseHandle(h_event);
            }
        }
    }

    pub fn get_devices() -> Vec<NativeAudioDevice> {
        let mut results = Vec::new();

        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: windows::core::Result<IMMDeviceEnumerator> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            let enumerator = match enumerator {
                Ok(e) => e,
                Err(_) => return results,
            };

            let default_id: Option<String> = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .ok()
                .and_then(|dev| dev.GetId().ok())
                .map(|id_pwstr| {
                    let s = id_pwstr.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(id_pwstr.0 as _));
                    s
                });

            let collection = match enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                Ok(c) => c,
                Err(_) => return results,
            };

            let count = collection.GetCount().unwrap_or(0);
            for i in 0..count {
                if let Ok(dev) = collection.Item(i) {
                    let id = match dev.GetId() {
                        Ok(id_pwstr) => {
                            let s = id_pwstr.to_string().unwrap_or_default();
                            CoTaskMemFree(Some(id_pwstr.0 as _));
                            s
                        }
                        Err(_) => continue,
                    };

                    let mut label = String::new();
                    if let Ok(props) = dev.OpenPropertyStore(STGM_READ) {
                        let key = windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY {
                            fmtid: windows::core::GUID::from_u128(
                                0xa45c254e_df1c_4efd_8020_67d146a850e0,
                            ),
                            pid: 2,
                        };
                        // `GetValue` returns `windows_core::PROPVARIANT`, whose `Display`
                        // renders an LPWSTR value and degrades to an empty string for
                        // anything else — no raw union access needed.
                        if let Ok(val) = props.GetValue(&key) {
                            label = val.to_string();
                        }
                    }

                    if label.is_empty() {
                        label = "Audio Endpoint".to_string();
                    }

                    let is_virtual = label.to_lowercase().contains("virtual")
                        || label.to_lowercase().contains("voicemeeter")
                        || label.to_lowercase().contains("cable");

                    let is_default = default_id.as_ref().is_some_and(|def| def == &id);

                    results.push(NativeAudioDevice {
                        id,
                        label,
                        is_default,
                        is_virtual,
                    });
                }
            }
        }

        results
    }
}

#[napi]
pub fn wasapi_is_supported() -> bool {
    platform::is_supported()
}

#[napi]
pub fn wasapi_init(
    device_id: Option<String>,
    sample_rate: u32,
    channels: u16,
    bit_depth: u16,
    buffer_ms: u32,
) -> NativeWasapiInitResult {
    platform::init(device_id, sample_rate, channels, bit_depth, buffer_ms)
}

#[napi]
pub fn wasapi_write(pcm: Float32Array) -> u32 {
    platform::write(&pcm)
}

#[napi]
pub fn wasapi_stop() {
    platform::stop();
}

#[napi]
pub fn wasapi_get_devices() -> Vec<NativeAudioDevice> {
    platform::get_devices()
}
