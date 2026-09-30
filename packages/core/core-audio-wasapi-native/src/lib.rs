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
  use windows::core::{Interface, GUID, PCWSTR, PWSTR};
  use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK};
  use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
  use windows::Win32::Media::Audio::*;
  use windows::Win32::System::Com::*;
  use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject, INFINITE};
  use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

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

      let enumerator: Result<IMMDeviceEnumerator, _> =
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

      let device: Result<IMMDevice, _> = if let Some(id_str) = device_id {
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

      let audio_client: Result<IAudioClient, _> = device.Activate(CLSCTX_ALL, None);
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
      let target_bit_depth = if bit_depth == 24 { 24 } else if bit_depth == 32 { 32 } else { 16 };
      let container_bits = if target_bit_depth == 24 { 32 } else { target_bit_depth };

      let block_align = (channels * (container_bits / 8)) as u16;
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
        dwChannelMask: if channels == 2 {
          SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT
        } else {
          SPEAKER_FRONT_CENTER
        },
        SubFormat: sub_format,
      };

      let p_format = &wave_format_ext as *const _ as *const WAVEFORMATEX;

      // Check format support
      let format_check = audio_client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, p_format, None);
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

      let buffer_duration_hns = (buffer_ms as i64) * 10_000;
      let init_res = audio_client.Initialize(
        AUDCLNT_SHAREMODE_EXCLUSIVE,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        buffer_duration_hns,
        buffer_duration_hns,
        p_format,
        None,
      );

      if let Err(err) = init_res {
        return NativeWasapiInitResult {
          ok: false,
          buffer_size_frames: None,
          actual_sample_rate: None,
          actual_bit_depth: None,
          error: Some(format!("Failed to initialize IAudioClient in exclusive mode: {:?}", err)),
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

      let buffer_size_frames = audio_client.GetBufferSize().unwrap_or(0);

      // Create lock-free SPSC ring buffer (e.g. 200ms capacity)
      let ring_capacity = (sample_rate as usize * channels as usize * 200) / 1000;
      let (producer, mut consumer) = rtrb::RingBuffer::new(ring_capacity);

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

      let client_clone = audio_client.clone();
      let render_thread = std::thread::spawn(move || {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let h_event = HANDLE(raw_event as _);

        while !stop_thread.load(Ordering::Relaxed) {
          let wait_res = WaitForSingleObject(h_event, 1000);
          if wait_res.0 != 0 || stop_thread.load(Ordering::Relaxed) {
            break;
          }

          let frames_needed = match client_clone.GetBufferSize() {
            Ok(f) => f,
            Err(_) => break,
          };

          let dest_buffer = match render_client.GetBuffer(frames_needed) {
            Ok(p) => p,
            Err(_) => continue,
          };

          let samples_needed = (frames_needed as usize) * (channels as usize);

          if target_bit_depth == 16 {
            let out_slice = std::slice::from_raw_parts_mut(dest_buffer as *mut i16, samples_needed);
            for s in out_slice.iter_mut() {
              if let Ok(val) = consumer.pop() {
                let clamped = val.clamp(-1.0, 1.0);
                *s = (clamped * 32767.0) as i16;
              } else {
                *s = 0; // silence on underrun
              }
            }
          } else if target_bit_depth == 24 {
            let out_slice = std::slice::from_raw_parts_mut(dest_buffer as *mut i32, samples_needed);
            for s in out_slice.iter_mut() {
              if let Ok(val) = consumer.pop() {
                let clamped = val.clamp(-1.0, 1.0);
                *s = ((clamped * 8388607.0) as i32) << 8;
              } else {
                *s = 0;
              }
            }
          } else {
            let out_slice = std::slice::from_raw_parts_mut(dest_buffer as *mut f32, samples_needed);
            for s in out_slice.iter_mut() {
              if let Ok(val) = consumer.pop() {
                *s = val.clamp(-1.0, 1.0);
              } else {
                *s = 0.0;
              }
            }
          }

          let _ = render_client.ReleaseBuffer(frames_needed, 0);
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
        let _ = SetEvent(h_event);
        if let Some(handle) = state.render_thread.take() {
          let _ = handle.join();
        }
        let _ = state.audio_client.Stop();
        let _ = CloseHandle(h_event);
      }
    }
  }

  pub fn get_devices() -> Vec<NativeAudioDevice> {
    let mut results = Vec::new();

    unsafe {
      let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
      let enumerator: Result<IMMDeviceEnumerator, _> =
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
              fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
              pid: 2,
            };
            if let Ok(val) = props.GetValue(&key) {
              if val.Anonymous.Anonymous.vt == windows::Win32::System::Variant::VT_LPWSTR {
                let p_str = val.Anonymous.Anonymous.Anonymous.pwszVal;
                if !p_str.is_null() {
                  label = PCWSTR(p_str.0).to_string().unwrap_or_default();
                }
              }
            }
          }

          if label.is_empty() {
            label = "Audio Endpoint".to_string();
          }

          let is_virtual = label.to_lowercase().contains("virtual")
            || label.to_lowercase().contains("voicemeeter")
            || label.to_lowercase().contains("cable");

          let is_default = default_id.as_ref().map_or(false, |def| def == &id);

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
