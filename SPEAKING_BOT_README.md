# Speaking Bot Audio Streaming Implementation

This document explains how the meeting bot receives external audio streams and injects them into meeting platforms (Google Meet, Microsoft Teams) to enable a "speaking bot" functionality.

## Overview

The speaking bot functionality allows external audio sources to be streamed into meeting platforms through a sophisticated audio pipeline that uses virtual microphones and WebSocket connections.

**Audio Pipeline Overview:**  
The bot creates a virtual audio pipeline where external audio streams are injected into a virtual microphone device that the browser meeting interface uses as its audio input source. The pipeline consists of the following steps:

1. **Audio Input Source**: The `streaming_input` parameter (from `src/types.ts:63`) is a WebSocket URL that provides the audio stream to be injected into the meeting. This parameter flows through the state machine and meeting providers.
2. **Streaming Service**: The core audio handling happens in the Streaming class (`src/streaming.ts`). It sets up a WebSocket server (port 8081) to receive audio from the Chrome extension, supports dual channels (input/output), and processes audio (including format conversion and sound level monitoring).
3. **Chrome Extension Audio Capture**: The Chrome extension (`chrome_extension/src/soundStreamer.ts`) captures tab audio using the Web Audio API, processes it in 256-sample chunks, and sends Float32Array audio data to the WebSocket server.
4. **Audio Injection into Meeting**: The SoundContext class (`src/media_context.ts`) uses a virtual microphone device (`pulse:virtual_mic`) and FFmpeg to pipe audio into the virtual microphone. The `play_stdin()` method creates an FFmpeg process that accepts Float32Array audio data.
5. **Integration Flow**: The `play_incoming_audio_chunks()` method (`src/streaming.ts:472-484`) connects the WebSocket input to the microphone by writing received audio data to FFmpeg's stdin, which pipes it to the virtual mic.
6. **Meeting Provider Integration**: In the meeting providers (e.g., `src/meeting/meet.ts:101-105`), when `streaming_input` is provided, the microphone is activated in the meeting, browser permissions are granted, and the virtual microphone becomes the audio input source.

## Architecture Components

### 1. Audio Input Source (`streaming_input` parameter)

- **Parameter**: `streaming_input` (defined in `src/types.ts:63`)
- **Type**: WebSocket URL string
- **Purpose**: Provides the external audio stream to be injected into the meeting
- **Flow**: Passes through state machine → meeting providers → streaming service

### 2. Streaming Service (`src/streaming.ts`)

The core audio handling component that manages the entire audio pipeline:

#### Key Features

- **WebSocket Server Setup**: Creates a WebSocket server on port 8081 to receive audio from the Chrome extension.
- **Dual Channel Support**: Handles both input (receiving audio to inject) and output (sending captured audio).
- **Audio Processing Pipeline**:
  - Receives Float32Array audio data from extension via WebSocket (`streaming.ts:131-180`).
  - Converts audio format (F32 → S16) for external output.
  - Buffers and processes audio for sound level monitoring.

#### Audio Processing Pipeline

```typescript
// Receives Float32Array audio data from extension
client.on('message', (message) => {
    if (message instanceof Buffer) {
        const uint8Array = new Uint8Array(message)
        const f32Array = new Float32Array(uint8Array.buffer)
        
        // Convert to Int16Array and send to output WebSocket
        const s16Array = new Int16Array(f32Array.length)
        for (let i = 0; i < f32Array.length; i++) {
            s16Array[i] = Math.round(Math.max(-32768, Math.min(32767, f32Array[i] * 32768)))
        }
        this.output_ws.send(s16Array.buffer)
    }
})
```

### 3. Chrome Extension Audio Capture (`chrome_extension/src/soundStreamer.ts`)

Captures meeting audio and sends it to the streaming service:

#### Implementation

- **SoundStreamer Class**: Captures tab audio using Web Audio API.
- **Process**:
  - Creates AudioContext with specified sample rate (24kHz default).
  - Uses `createMediaStreamSource()` to capture meeting audio.
  - Processes audio through ScriptProcessorNode in 256-sample chunks.
  - Sends Float32Array audio data to WebSocket server at `ws://localhost:8081`.

```typescript
export class SoundStreamer {
    private ws: WebSocket
    private processor: ScriptProcessorNode | null = null
    private streaming_audio_frequency: number = 24_000 // 24kHz default
    
    public start(stream: MediaStream, streaming_audio_frequency: number | undefined) {
        const audioContext = new AudioContext({ sampleRate: this.streaming_audio_frequency })
        const source = audioContext.createMediaStreamSource(stream)
        this.processor = audioContext.createScriptProcessor(256, 1, 1) // 256-sample chunks
        
        this.processor.onaudioprocess = (audioProcessingEvent) => {
            const inputData: Float32Array = audioProcessingEvent.inputBuffer.getChannelData(0)
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(inputData.buffer) // Send to WebSocket server
            }
        }
    }
}
```

### 4. Virtual Microphone Injection (`src/media_context.ts`)

The critical component that injects audio into the meeting's microphone:

#### SoundContext Class

- **Virtual Microphone Device**: Uses `pulse:virtual_mic` (PulseAudio virtual microphone).
- **FFmpeg Integration**: Uses ffmpeg to pipe audio into the virtual microphone.
- **Audio Pipeline**:
  - `play_stdin()` method (`media_context.ts:129-150`) creates an ffmpeg process.
  - Command: `ffmpeg -f f32le -ar <sample_rate> -ac 1 -i - -f alsa -acodec pcm_s16le pulse:virtual_mic`
  - Returns a writable stream that accepts Float32Array audio data.

#### Key Method - `play_stdin()`

```typescript
public play_stdin(): internal.Writable {
    // FFmpeg command to pipe audio to virtual microphone
    let args: string[] = [
        `-f`, `f32le`,           // Input format: 32-bit float little-endian
        `-ar`, `${this.sampleRate}`, // Sample rate (typically 24kHz)
        `-ac`, `1`,              // Audio channels: mono
        `-i`, `-`,               // Input from stdin
        `-f`, `alsa`,            // Output format: ALSA
        `-acodec`, `pcm_s16le`,  // Audio codec: 16-bit PCM
        MICRO_DEVICE             // Output device: pulse:virtual_mic
    ]
    return super.execute(args, () => {
        console.warn(`[play_stdin] Sequence ended`)
    }).stdin
}
```

### 5. Audio Pipeline Integration (`src/streaming.ts:472-484`)

Connects WebSocket input to virtual microphone:

```typescript
private play_incoming_audio_chunks = (input_ws: WebSocket) => {
    new SoundContext(this.sample_rate)
    let stdin = SoundContext.instance.play_stdin()  // Create FFmpeg process
    let audio_stream = this.createAudioStreamFromWebSocket(input_ws)
    
    audio_stream.on('data', (chunk) => {
        stdin.write(chunk) // Write directly to FFmpeg stdin → virtual mic
    })
    
    audio_stream.on('end', () => {
        stdin.end() // Close stdin when stream ends
    })
}
```

### 6. Meeting Provider Integration

In meeting providers (e.g., `src/meeting/meet.ts:101-105`):

- When `streaming_input` is provided, the microphone is activated in the meeting.
- Browser permissions are granted for microphone access.
- The virtual microphone becomes the audio input source for the meeting.

```typescript
// Control microphone based on streaming_input
if (meetingParams.streaming_input) {
    await activateMicrophone(page)  // Enable microphone in meeting
} else {
    await deactivateMicrophone(page) // Disable microphone
}
```

#### Browser Permissions

```typescript
// Set permissions based on streaming_input
if (streaming_input) {
    await browserContext.grantPermissions(['microphone', 'camera'])
} else {
    await browserContext.grantPermissions(['camera'])
}
```

## Complete Audio Flow

1. External Audio Source → WebSocket (streaming_input URL)
2. Streaming Service → Receives audio via WebSocket, processes and forwards
3. SoundContext/FFmpeg → Pipes audio to virtual microphone device (pulse:virtual_mic)
4. Meeting Browser → Uses virtual microphone as audio input source
5. Chrome Extension → Captures meeting audio and sends back via WebSocket
6. Other Meeting Participants

## System Requirements

### Audio System Setup

- **PulseAudio**: Required for virtual microphone functionality
- **Virtual Microphone Device**: `pulse:virtual_mic` must be configured
- **FFmpeg**: Required for audio format conversion and piping

### Alternative Setup (commented in code)

```bash
# Hardware loopback module approach (alternative to PulseAudio)
sudo apt install linux-modules-extra-`uname -r`
# Uses: hw:Loopback,1 (sndloop module)
```

## Performance Optimizations

### Audio Processing

- **Batch Processing**: Buffers audio chunks to reduce CPU overhead
- **Adaptive Sampling**: Adjusts processing based on buffer size
- **Throttled Logging**: Reduces I/O operations for performance monitoring

### Configuration

- **Sample Rate**: 24kHz default (configurable via `streaming_audio_frequency`)
- **Buffer Size**: 256 samples for Chrome extension processing
- **Chunk Duration**: Configurable for recording segments

## Error Handling

### Common Issues

1. **WebSocket Connection Failures**: Automatic reconnection logic
2. **Virtual Microphone Access**: Proper device permissions required
3. **Audio Format Mismatches**: Conversion between Float32 and Int16 formats
4. **FFmpeg Process Management**: Proper cleanup and error handling

### Debugging

- **Sound Level Monitoring**: Real-time audio level analysis and logging
- **Performance Metrics**: Audio packet counting and statistics
- **Screenshot Capture**: Visual debugging for meeting join issues

## Usage Example

To enable speaking bot functionality:

```typescript
const meetingParams: MeetingParams = {
    // ... other parameters
    streaming_input: "ws://external-audio-server:8080/audio-stream",
    streaming_audio_frequency: 24000,
    // ... other parameters
}
```

This will:

1. Connect to the external audio WebSocket
2. Set up the virtual microphone pipeline
3. Enable microphone permissions in the browser
4. Stream external audio into the meeting as if spoken by the bot
