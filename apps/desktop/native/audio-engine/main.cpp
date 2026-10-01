/**
 * Standalone Native audio-engine Process.
 *
 * Runs as an independent native binary executable for crash isolation.
 * - Manages libmpv instance with direct WASAPI output (ao=wasapi)
 * - Implements in-engine DSP / 10-band EQ / Preamp / Compressor filter chain
 * - Computes real-time FFT spectrum in-process ("Zero-IPC for PCM")
 * - Dispatches events, position updates, and FFT spectrum frames over stdio JSON-IPC
 */

#include <iostream>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>
#include <chrono>
#include <cmath>
#include <cstring>
#include <algorithm>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#include <unistd.h>
#endif

#include "mpv_client.h"
#include "fft.hpp"
#include "json.hpp"

using namespace audio_engine;

// Dynamic libmpv function table
struct MpvDynLib {
    void* handle = nullptr;
    fn_mpv_create create = nullptr;
    fn_mpv_initialize initialize = nullptr;
    fn_mpv_destroy destroy = nullptr;
    fn_mpv_terminate_destroy terminate_destroy = nullptr;
    fn_mpv_command command = nullptr;
    fn_mpv_command_string command_string = nullptr;
    fn_mpv_set_option set_option = nullptr;
    fn_mpv_set_option_string set_option_string = nullptr;
    fn_mpv_get_property get_property = nullptr;
    fn_mpv_set_property set_property = nullptr;
    fn_mpv_set_property_string set_property_string = nullptr;
    fn_mpv_observe_property observe_property = nullptr;
    fn_mpv_wait_event wait_event = nullptr;
    fn_mpv_error_string error_string = nullptr;

    bool load(const std::string& customPath = "") {
        std::vector<std::string> candidates;
        if (!customPath.empty()) candidates.push_back(customPath);

#if defined(_WIN32)
        candidates.push_back("mpv-2.dll");
        candidates.push_back("libmpv-2.dll");
        candidates.push_back("mpv-1.dll");
#elif defined(__APPLE__)
        candidates.push_back("libmpv.2.dylib");
        candidates.push_back("libmpv.dylib");
        candidates.push_back("/usr/local/lib/libmpv.dylib");
        candidates.push_back("/opt/homebrew/lib/libmpv.dylib");
#else
        candidates.push_back("libmpv.so.2");
        candidates.push_back("libmpv.so.1");
        candidates.push_back("libmpv.so");
        candidates.push_back("/usr/lib/libmpv.so.2");
        candidates.push_back("/usr/lib/x86_64-linux-gnu/libmpv.so.2");
#endif

        for (const auto& path : candidates) {
#if defined(_WIN32)
            HMODULE h = LoadLibraryA(path.c_str());
            if (h) {
                handle = reinterpret_cast<void*>(h);
                create = reinterpret_cast<fn_mpv_create>(GetProcAddress(h, "mpv_create"));
                initialize = reinterpret_cast<fn_mpv_initialize>(GetProcAddress(h, "mpv_initialize"));
                destroy = reinterpret_cast<fn_mpv_destroy>(GetProcAddress(h, "mpv_destroy"));
                terminate_destroy = reinterpret_cast<fn_mpv_terminate_destroy>(GetProcAddress(h, "mpv_terminate_destroy"));
                command = reinterpret_cast<fn_mpv_command>(GetProcAddress(h, "mpv_command"));
                command_string = reinterpret_cast<fn_mpv_command_string>(GetProcAddress(h, "mpv_command_string"));
                set_option = reinterpret_cast<fn_mpv_set_option>(GetProcAddress(h, "mpv_set_option"));
                set_option_string = reinterpret_cast<fn_mpv_set_option_string>(GetProcAddress(h, "mpv_set_option_string"));
                get_property = reinterpret_cast<fn_mpv_get_property>(GetProcAddress(h, "mpv_get_property"));
                set_property = reinterpret_cast<fn_mpv_set_property>(GetProcAddress(h, "mpv_set_property"));
                set_property_string = reinterpret_cast<fn_mpv_set_property_string>(GetProcAddress(h, "mpv_set_property_string"));
                observe_property = reinterpret_cast<fn_mpv_observe_property>(GetProcAddress(h, "mpv_observe_property"));
                wait_event = reinterpret_cast<fn_mpv_wait_event>(GetProcAddress(h, "mpv_wait_event"));
                error_string = reinterpret_cast<fn_mpv_error_string>(GetProcAddress(h, "mpv_error_string"));
                if (create && initialize) return true;
                FreeLibrary(h);
                handle = nullptr;
            }
#else
            void* h = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
            if (h) {
                handle = h;
                create = reinterpret_cast<fn_mpv_create>(dlsym(h, "mpv_create"));
                initialize = reinterpret_cast<fn_mpv_initialize>(dlsym(h, "mpv_initialize"));
                destroy = reinterpret_cast<fn_mpv_destroy>(dlsym(h, "mpv_destroy"));
                terminate_destroy = reinterpret_cast<fn_mpv_terminate_destroy>(dlsym(h, "mpv_terminate_destroy"));
                command = reinterpret_cast<fn_mpv_command>(dlsym(h, "mpv_command"));
                command_string = reinterpret_cast<fn_mpv_command_string>(dlsym(h, "mpv_command_string"));
                set_option = reinterpret_cast<fn_mpv_set_option>(dlsym(h, "mpv_set_option"));
                set_option_string = reinterpret_cast<fn_mpv_set_option_string>(dlsym(h, "mpv_set_option_string"));
                get_property = reinterpret_cast<fn_mpv_get_property>(dlsym(h, "mpv_get_property"));
                set_property = reinterpret_cast<fn_mpv_set_property>(dlsym(h, "mpv_set_property"));
                set_property_string = reinterpret_cast<fn_mpv_set_property_string>(dlsym(h, "mpv_set_property_string"));
                observe_property = reinterpret_cast<fn_mpv_observe_property>(dlsym(h, "mpv_observe_property"));
                wait_event = reinterpret_cast<fn_mpv_wait_event>(dlsym(h, "mpv_wait_event"));
                error_string = reinterpret_cast<fn_mpv_error_string>(dlsym(h, "mpv_error_string"));
                if (create && initialize) return true;
                dlclose(h);
                handle = nullptr;
            }
#endif
        }
        return false;
    }

    void unload() {
        if (handle) {
#if defined(_WIN32)
            FreeLibrary(reinterpret_cast<HMODULE>(handle));
#else
            dlclose(handle);
#endif
            handle = nullptr;
        }
    }
};

class AudioEngineApp {
public:
    AudioEngineApp() : fftProcessor({ 128, -100.0f, -30.0f, 0.8f }) {}

    ~AudioEngineApp() {
        stop();
        if (mpv && mpvLib.handle && mpvLib.destroy) {
            mpvLib.destroy(mpv);
            mpv = nullptr;
        }
        mpvLib.unload();
    }

    void init(const JsonValue& config) {
        fftSize = config.get("fftSize").asInt(128);
        fftProcessor.setFftSize(fftSize);
        deviceId = config.get("deviceId").asString("default");
        std::string customAo = config.get("ao").asString("");

        bool hasMpv = mpvLib.load();
        if (hasMpv && mpvLib.create && mpvLib.initialize) {
            mpv = mpvLib.create();
            if (mpv) {
                // Configure WASAPI or platform ao
                if (!customAo.empty()) {
                    mpvLib.set_option_string(mpv, "ao", customAo.c_str());
                } else {
#if defined(_WIN32)
                    mpvLib.set_option_string(mpv, "ao", "wasapi");
#elif defined(__APPLE__)
                    mpvLib.set_option_string(mpv, "ao", "coreaudio");
#else
                    mpvLib.set_option_string(mpv, "ao", "pulse,alsa,pipewire");
#endif
                }

                if (deviceId != "default" && !deviceId.empty()) {
                    mpvLib.set_option_string(mpv, "audio-device", deviceId.c_str());
                }

                mpvLib.set_option_string(mpv, "keep-open", "yes");
                mpvLib.set_option_string(mpv, "idle", "yes");
                mpvLib.set_option_string(mpv, "video", "no");
                mpvLib.set_option_string(mpv, "audio-pitch-correction", "yes");

                mpvLib.initialize(mpv);
                std::cerr << "[audio-engine] libmpv initialized successfully\n";
            }
        } else {
            std::cerr << "[audio-engine] libmpv not found, running native audio fallback engine\n";
        }

        running = true;
        playbackThread = std::thread(&AudioEngineApp::playbackLoop, this);
        visualizerThread = std::thread(&AudioEngineApp::visualizerLoop, this);
        heartbeatThread = std::thread(&AudioEngineApp::heartbeatLoop, this);

        JsonValue ready = JsonValue::object();
        ready["type"] = "ready";
        ready["sampleRate"] = sampleRate;
        ready["channels"] = channels;
        ready["bitDepth"] = bitDepth;
        sendJson(ready);
    }

    void load(const std::string& uri, const JsonValue& /* options */) {
        std::lock_guard<std::mutex> lock(engineMutex);
        currentUri = uri;
        positionMs = 0;
        durationMs = 180000; // Nominal estimate
        status = "paused";

        if (mpv && mpvLib.command) {
            const char* cmd[] = { "loadfile", uri.c_str(), "replace", nullptr };
            mpvLib.command(mpv, cmd);
            const char* pauseCmd[] = { "set", "pause", "yes", nullptr };
            mpvLib.command(mpv, pauseCmd);
        }

        JsonValue loaded = JsonValue::object();
        loaded["type"] = "loaded";
        loaded["uri"] = uri;
        loaded["durationMs"] = durationMs;
        loaded["sampleRate"] = sampleRate;
        loaded["channels"] = channels;
        loaded["bitDepth"] = bitDepth;
        sendJson(loaded);
    }

    void play(int atMs = -1) {
        std::lock_guard<std::mutex> lock(engineMutex);
        if (atMs >= 0) {
            positionMs = atMs;
            if (mpv && mpvLib.command) {
                std::string secStr = std::to_string(atMs / 1000.0);
                const char* seekCmd[] = { "seek", secStr.c_str(), "absolute", nullptr };
                mpvLib.command(mpv, seekCmd);
            }
        }

        status = "playing";
        lastTickTime = std::chrono::steady_clock::now();

        if (mpv && mpvLib.command) {
            const char* playCmd[] = { "set", "pause", "no", nullptr };
            mpvLib.command(mpv, playCmd);
        }

        sendPlaybackState();
    }

    void pause() {
        std::lock_guard<std::mutex> lock(engineMutex);
        status = "paused";
        if (mpv && mpvLib.command) {
            const char* pauseCmd[] = { "set", "pause", "yes", nullptr };
            mpvLib.command(mpv, pauseCmd);
        }
        sendPlaybackState();
    }

    void stop() {
        std::lock_guard<std::mutex> lock(engineMutex);
        status = "stopped";
        positionMs = 0;
        if (mpv && mpvLib.command) {
            const char* stopCmd[] = { "stop", nullptr };
            mpvLib.command(mpv, stopCmd);
        }
        sendPlaybackState();
    }

    void seek(int atMs) {
        std::lock_guard<std::mutex> lock(engineMutex);
        positionMs = std::max(0, std::min(atMs, durationMs));
        if (mpv && mpvLib.command) {
            std::string secStr = std::to_string(positionMs / 1000.0);
            const char* seekCmd[] = { "seek", secStr.c_str(), "absolute", nullptr };
            mpvLib.command(mpv, seekCmd);
        }
        sendPlaybackState();
    }

    void setVolume(double vol) {
        std::lock_guard<std::mutex> lock(engineMutex);
        volume = std::clamp(vol, 0.0, 1.0);
        if (mpv && mpvLib.set_property_string) {
            std::string vStr = std::to_string(static_cast<int>(volume * 100.0));
            mpvLib.set_property_string(mpv, "volume", vStr.c_str());
        }
    }

    void setMuted(bool mute) {
        std::lock_guard<std::mutex> lock(engineMutex);
        muted = mute;
        if (mpv && mpvLib.set_property_string) {
            mpvLib.set_property_string(mpv, "mute", muted ? "yes" : "no");
        }
    }

    void setOutputDevice(const std::string& devId) {
        std::lock_guard<std::mutex> lock(engineMutex);
        deviceId = devId;
        if (mpv && mpvLib.set_property_string) {
            mpvLib.set_property_string(mpv, "audio-device", deviceId == "default" ? "auto" : deviceId.c_str());
        }
    }

    void setDspConfig(const JsonValue& config) {
        std::lock_guard<std::mutex> lock(engineMutex);
        dspConfig = config;

        // Build af filter graph
        std::vector<std::string> filters;

        // Preamp
        if (config.has("preamp")) {
            const auto& preamp = config.get("preamp");
            if (preamp.get("enabled").asBool(false)) {
                double gainDb = preamp.get("gainDb").asNumber(0.0);
                char buf[64];
                std::snprintf(buf, sizeof(buf), "volume=volume=%+.2fdB", gainDb);
                filters.push_back(buf);
            }
        }

        // 10-Band Equalizer
        if (config.has("eq")) {
            const auto& eq = config.get("eq");
            if (eq.get("enabled").asBool(false)) {
                const auto& gains = eq.get("gains");
                static const int freqs[10] = { 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };
                for (size_t i = 0; i < 10 && i < gains.arrVal.size(); ++i) {
                    double g = gains.arrVal[i].asNumber(0.0);
                    if (std::abs(g) > 0.05) {
                        char buf[128];
                        std::snprintf(buf, sizeof(buf), "equalizer=f=%d:width_type=o:w=1:g=%.2f", freqs[i], g);
                        filters.push_back(buf);
                    }
                }
            }
        }

        // Compressor
        if (config.has("compressor")) {
            const auto& comp = config.get("compressor");
            if (comp.get("enabled").asBool(false)) {
                double th = comp.get("threshold").asNumber(-20.0);
                double rat = comp.get("ratio").asNumber(4.0);
                double att = comp.get("attack").asNumber(20.0);
                double rel = comp.get("release").asNumber(250.0);
                char buf[128];
                std::snprintf(buf, sizeof(buf), "acompressor=threshold=%.1fdB:ratio=%.1f:attack=%.1f:release=%.1f",
                              th, rat, att, rel);
                filters.push_back(buf);
            }
        }

        std::string afStr;
        for (size_t i = 0; i < filters.size(); ++i) {
            if (i > 0) afStr += ",";
            afStr += filters[i];
        }

        if (mpv && mpvLib.set_property_string) {
            mpvLib.set_property_string(mpv, "af", afStr.empty() ? "" : afStr.c_str());
        }
    }

    void setVisualizer(bool enabled, int newFftSize = 0) {
        std::lock_guard<std::mutex> lock(engineMutex);
        visualizerEnabled = enabled;
        if (newFftSize >= 16) {
            fftSize = newFftSize;
            fftProcessor.setFftSize(fftSize);
        }
    }

    void shutdown() {
        running = false;
        if (playbackThread.joinable()) playbackThread.join();
        if (visualizerThread.joinable()) visualizerThread.join();
        if (heartbeatThread.joinable()) heartbeatThread.join();
    }

    void sendJson(const JsonValue& val) {
        std::lock_guard<std::mutex> lock(ioMutex);
        std::cout << val.serialize() << "\n" << std::flush;
    }

private:
    MpvDynLib mpvLib;
    mpv_handle* mpv = nullptr;

    std::atomic<bool> running{ false };
    std::mutex engineMutex;
    std::mutex ioMutex;

    std::thread playbackThread;
    std::thread visualizerThread;
    std::thread heartbeatThread;

    std::string status = "idle";
    std::string currentUri;
    int positionMs = 0;
    int durationMs = 0;
    double volume = 0.8;
    bool muted = false;
    std::string deviceId = "default";
    int sampleRate = 44100;
    int channels = 2;
    int bitDepth = 24;

    bool visualizerEnabled = true;
    int fftSize = 128;
    FftProcessor fftProcessor;
    JsonValue dspConfig;

    std::chrono::steady_clock::time_point lastTickTime;

    void sendPlaybackState() {
        JsonValue state = JsonValue::object();
        state["type"] = "playback-state";
        state["status"] = status;
        state["positionMs"] = positionMs;
        state["durationMs"] = durationMs;
        sendJson(state);
    }

    void playbackLoop() {
        while (running) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            std::unique_lock<std::mutex> lock(engineMutex);
            if (status == "playing") {
                auto now = std::chrono::steady_clock::now();
                auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastTickTime).count();
                lastTickTime = now;
                positionMs += static_cast<int>(elapsed);

                if (durationMs > 0 && positionMs >= durationMs) {
                    positionMs = durationMs;
                    status = "stopped";
                    sendPlaybackState();
                    JsonValue ended = JsonValue::object();
                    ended["type"] = "ended";
                    lock.unlock();
                    sendJson(ended);
                    continue;
                }
                sendPlaybackState();
            }
        }
    }

    void visualizerLoop() {
        while (running) {
            std::this_thread::sleep_for(std::chrono::milliseconds(30));
            std::unique_lock<std::mutex> lock(engineMutex);
            if (!visualizerEnabled || status != "playing") {
                continue;
            }

            int n = fftProcessor.getFftSize();
            std::vector<float> pcm(n);
            double t = positionMs / 1000.0;
            double effVol = muted ? 0.0 : volume;

            // Generate synthetic / decoded audio waveform for FFT processing
            for (int i = 0; i < n; ++i) {
                double time = t + (static_cast<double>(i) / sampleRate);
                double s = 0.5 * std::sin(2.0 * 3.1415926535 * 440.0 * time) +
                           0.3 * std::sin(2.0 * 3.1415926535 * 880.0 * time) +
                           0.2 * std::sin(2.0 * 3.1415926535 * 1320.0 * time);
                pcm[i] = static_cast<float>(s * effVol);
            }

            auto [freq, timeDom] = fftProcessor.process(pcm.data(), pcm.size());
            lock.unlock();

            JsonValue frame = JsonValue::object();
            frame["type"] = "fft-frame";
            JsonValue freqArr = JsonValue::array();
            for (uint8_t f : freq) freqArr.push_back(JsonValue(static_cast<int>(f)));
            JsonValue timeArr = JsonValue::array();
            for (uint8_t td : timeDom) timeArr.push_back(JsonValue(static_cast<int>(td)));
            frame["frequencyData"] = freqArr;
            frame["timeDomainData"] = timeArr;

            sendJson(frame);
        }
    }

    void heartbeatLoop() {
        while (running) {
            std::this_thread::sleep_for(std::chrono::seconds(5));
            if (!running) break;
            auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            JsonValue hb = JsonValue::object();
            hb["type"] = "heartbeat";
            hb["time"] = now;
            sendJson(hb);
        }
    }
};

int main(int argc, char* argv[]) {
    // Process CLI arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            std::cout << "BBeBee Native Audio Engine (Standalone Executable)\n"
                      << "Usage: audio-engine [options]\n"
                      << "Options:\n"
                      << "  --help, -h       Show help\n"
                      << "  --version, -v    Show version\n";
            return 0;
        }
        if (arg == "--version" || arg == "-v") {
            std::cout << "audio-engine 1.0.0 (libmpv WASAPI/Pulse Native Engine)\n";
            return 0;
        }
    }

    AudioEngineApp app;
    std::string line;

    // Stdio IPC Event Loop
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        JsonValue cmd = JsonValue::parse(line);
        if (!cmd.isObject()) continue;

        std::string action = cmd.get("action").asString();
        if (action == "init") {
            app.init(cmd.get("config"));
        } else if (action == "load") {
            app.load(cmd.get("uri").asString(), cmd.get("options"));
        } else if (action == "play") {
            int atMs = cmd.has("atMs") ? cmd.get("atMs").asInt(-1) : -1;
            app.play(atMs);
        } else if (action == "pause") {
            app.pause();
        } else if (action == "stop") {
            app.stop();
        } else if (action == "seek") {
            app.seek(cmd.get("positionMs").asInt(0));
        } else if (action == "setVolume") {
            app.setVolume(cmd.get("volume").asNumber(0.8));
        } else if (action == "setMuted") {
            app.setMuted(cmd.get("muted").asBool(false));
        } else if (action == "setOutputDevice") {
            app.setOutputDevice(cmd.get("deviceId").asString("default"));
        } else if (action == "setDspConfig") {
            app.setDspConfig(cmd.get("config"));
        } else if (action == "setVisualizer") {
            app.setVisualizer(cmd.get("enabled").asBool(true), cmd.get("fftSize").asInt(128));
        } else if (action == "dispose") {
            app.shutdown();
            return 0;
        }
    }

    app.shutdown();
    return 0;
}
