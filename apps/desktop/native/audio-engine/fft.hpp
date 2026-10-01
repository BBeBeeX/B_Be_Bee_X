#ifndef FFT_HPP
#define FFT_HPP

#include <vector>
#include <complex>
#include <cmath>
#include <algorithm>
#include <cstdint>

namespace audio_engine {

struct FftOptions {
    int fftSize = 128;
    float minDecibels = -100.0f;
    float maxDecibels = -30.0f;
    float smoothingTimeConstant = 0.8f;
};

class FftProcessor {
public:
    using Options = FftOptions;

    FftProcessor() : opts() {
        initWindow();
    }

    explicit FftProcessor(const FftOptions& options) : opts(options) {
        initWindow();
    }

    void setFftSize(int newSize) {
        if (newSize < 16) newSize = 16;
        if (newSize > 2048) newSize = 2048;
        // Ensure power of 2
        int p = 1;
        while (p < newSize) p <<= 1;
        opts.fftSize = p;
        initWindow();
    }

    int getFftSize() const { return opts.fftSize; }
    int getFrequencyBinCount() const { return opts.fftSize / 2; }

    std::pair<std::vector<uint8_t>, std::vector<uint8_t>> process(const float* pcmSamples, size_t sampleCount) {
        const int N = opts.fftSize;
        const int binCount = N / 2;

        std::vector<std::complex<float>> buffer(N, 0.0f);
        std::vector<uint8_t> timeDomain(binCount, 128);

        // Copy samples into buffer and apply window
        size_t take = std::min(sampleCount, static_cast<size_t>(N));
        for (size_t i = 0; i < take; ++i) {
            float s = pcmSamples[i];
            buffer[i] = s * window[i];
            if (i < static_cast<size_t>(binCount)) {
                float norm = (s + 1.0f) * 127.5f;
                timeDomain[i] = static_cast<uint8_t>(std::clamp(norm, 0.0f, 255.0f));
            }
        }

        // Fill remaining time domain bins if sampleCount < binCount
        for (size_t i = take; i < static_cast<size_t>(binCount); ++i) {
            timeDomain[i] = 128;
        }

        // Perform Cooley-Tukey Radix-2 FFT
        cooleyTukey(buffer);

        // Calculate magnitude, dB, and smoothing
        std::vector<uint8_t> frequencyData(binCount, 0);
        float dbRange = opts.maxDecibels - opts.minDecibels;
        if (dbRange <= 0.0f) dbRange = 1.0f;

        for (int i = 0; i < binCount; ++i) {
            float magnitude = std::abs(buffer[i]) / (N / 2.0f);
            float db = 20.0f * std::log10(magnitude + 1e-6f);
            float normalized = ((db - opts.minDecibels) / dbRange) * 255.0f;
            float clamped = std::clamp(normalized, 0.0f, 255.0f);

            // Temporal smoothing
            float smoothed = opts.smoothingTimeConstant * previousSpectrum[i] +
                             (1.0f - opts.smoothingTimeConstant) * clamped;
            previousSpectrum[i] = smoothed;
            frequencyData[i] = static_cast<uint8_t>(std::round(smoothed));
        }

        return { std::move(frequencyData), std::move(timeDomain) };
    }

private:
    Options opts;
    std::vector<float> window;
    std::vector<float> previousSpectrum;

    void initWindow() {
        const int N = opts.fftSize;
        window.resize(N);
        previousSpectrum.assign(N / 2, 0.0f);
        constexpr float PI = 3.14159265358979323846f;
        for (int i = 0; i < N; ++i) {
            window[i] = 0.5f * (1.0f - std::cos(2.0f * PI * static_cast<float>(i) / static_cast<float>(N - 1)));
        }
    }

    void cooleyTukey(std::vector<std::complex<float>>& a) {
        int n = static_cast<int>(a.size());
        for (int i = 1, j = 0; i < n; ++i) {
            int bit = n >> 1;
            for (; j & bit; bit >>= 1) {
                j ^= bit;
            }
            j ^= bit;
            if (i < j) std::swap(a[i], a[j]);
        }

        constexpr float PI = 3.14159265358979323846f;
        for (int len = 2; len <= n; len <<= 1) {
            float ang = -2.0f * PI / len;
            std::complex<float> wlen(std::cos(ang), std::sin(ang));
            for (int i = 0; i < n; i += len) {
                std::complex<float> w(1.0f, 0.0f);
                for (int j = 0; j < len / 2; ++j) {
                    std::complex<float> u = a[i + j];
                    std::complex<float> v = a[i + j + len / 2] * w;
                    a[i + j] = u + v;
                    a[i + j + len / 2] = u - v;
                    w *= wlen;
                }
            }
        }
    }
};

} // namespace audio_engine

#endif // FFT_HPP
