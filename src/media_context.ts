import { ChildProcess, spawn } from 'child_process'
import internal from 'stream'

// Multiple device options to try in order of preference
const MICRO_DEVICES: string[] = [
  'virtual_mic',                 // Primary target (this one works!)
  'pulse:virtual_mic',           // Alternative naming
  'pulse:virtual_mic.monitor',   // Monitor source
  'pulse:default',               // Fallback to default
]

const CAMERA_DEVICE: string = '/dev/video10'

// This abstract class contains the current ffmpeg process
// A derived class must implement play and stop methods
//
// ___DUAL_CHANNEL_EXAMPLES
// ffmpeg -re -i La_bataille_de_Farador2.mp4 \
// -map 0:v -f v4l2 -vcodec copy /dev/video10 \
// -map 0:a -f alsa -ac 2 -ar 44100 hw:Loopback,
//
// ffmpeg -re -i La_bataille_de_Farador.mp4 \
//    -map 0:v -f v4l2 -vcodec mjpeg -s 640x360 /dev/video10 \
//    -map 0:a -f alsa -ac 2 -ar 44100 hw:Loopback,1
abstract class MediaContext {
  private process: ChildProcess | null
  private promise: Promise<number> | null

  constructor() {
    this.process = null
    this.promise = null
  }

  protected execute(
    args: string[],
    after: { (): void },
  ): ChildProcess | null {
    if (this.process) {
      console.warn('Already on execution')
      return null
    }

    console.log('🎵 Executing ffmpeg with args:', args.join(' '))

    this.process = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.promise = new Promise((resolve, reject) => {
      this.process.on('exit', (code) => {
        console.log(`🔚 FFmpeg process exited with code ${code}`)
        if (code == 0) {
          this.process = null
          after()
        } else {
          console.error(`❌ FFmpeg failed with exit code ${code}`)
        }
        resolve(code)
      })

      this.process.on('error', (err) => {
        console.error('❌ FFmpeg process error:', err)
        reject(err)
      })

      // Enhanced logging for debugging
      this.process.stdout.on('data', (data) => {
        console.log(`📤 FFmpeg stdout: ${data.toString().trim()}`)
      })

      this.process.stderr.on('data', (data) => {
        const output = data.toString().trim()
        if (output.includes('Error') || output.includes('error')) {
          console.error(`❌ FFmpeg stderr: ${output}`)
        } else {
          console.log(`📋 FFmpeg info: ${output}`)
        }
      })
    })

    return this.process
  }

  protected async stop_process() {
    if (!this.process) {
      console.warn('Already stopped')
      return
    }

    let res = this.process.kill('SIGTERM')
    console.log(`📤 Signal sent to process: ${res}`)

    await this.promise
      .then((code) => {
        console.log(`🔚 Process exited with code ${code}`)
      })
      .catch((err) => {
        console.log(`❌ Process exited with error ${err}`)
      })
      .finally(() => {
        this.process = null
        this.promise = null
      })
  }

  public abstract play(pathname: string, loop: boolean): void

  public abstract stop(): void
}

// Sound events into microphone device
export class SoundContext extends MediaContext {
  public static instance: SoundContext

  private sampleRate: number
  private currentMicroDevice: string | null = null

  constructor(sampleRate: number) {
    super()
    this.sampleRate = sampleRate
    SoundContext.instance = this
  }

  // Test which microphone device works
  private async findWorkingMicroDevice(): Promise<string | null> {
    if (this.currentMicroDevice) {
      return this.currentMicroDevice
    }

    console.log('🔍 Testing available microphone devices...')

    for (const device of MICRO_DEVICES) {
      console.log(`🧪 Testing device: ${device}`)

      try {
        // Quick test with timeout
        const testProcess = spawn('ffmpeg', [
          '-f', 'pulse',
          '-i', device,
          '-t', '0.1',
          '-f', 'null',
          '-'
        ], { stdio: ['pipe', 'pipe', 'pipe'] })

        const result = await new Promise<number>((resolve) => {
          const timeout = setTimeout(() => {
            testProcess.kill('SIGTERM')
            resolve(124) // timeout code
          }, 3000)

          testProcess.on('exit', (code) => {
            clearTimeout(timeout)
            resolve(code || 0)
          })

          testProcess.on('error', () => {
            clearTimeout(timeout)
            resolve(1)
          })
        })

        if (result === 0 || result === 124) {
          console.log(`✅ Device ${device} works!`)
          this.currentMicroDevice = device
          return device
        } else {
          console.log(`❌ Device ${device} failed with code ${result}`)
        }
      } catch (error) {
        console.log(`❌ Device ${device} test failed:`, error)
      }
    }

    console.error('❌ No working microphone device found!')
    return null
  }

  public default() {
    SoundContext.instance.play(`../silence.opus`, false)
  }

  public async play(pathname: string, loop: boolean) {
    // ffmpeg -stream_loop -1 -re -i La_bataille_de_Farador.mp4 -f alsa -ac 2 -ar 44100 hw:Loopback,1
    // ffmpeg -re -i cow_sound.mp3 -f alsa -acodec pcm_s16le "pulse:virtual_mic"
    const device = await this.findWorkingMicroDevice()
    if (!device) {
      console.error('❌ Cannot play: no working microphone device available')
      return
    }

    let args: string[] = []
    if (loop) {
      args.push(`-stream_loop`, `-1`)
    }
    args.push(
      `-re`,
      `-i`,
      pathname,
      `-f`,
      `alsa`,
      `-acodec`,
      `pcm_s16le`,
      device,
    )

    console.log(`🎵 Playing to device: ${device}`)
    super.execute(args, this.default)
  }

  // Return stdin and play sound to microphone
  public async play_stdin(): Promise<internal.Writable | null> {
    // ffmpeg -f f32le -ar 48000 -ac 1 -i - -f alsa -acodec pcm_s16le "pulse:virtual_mic"
    const device = await this.findWorkingMicroDevice()
    if (!device) {
      console.error('❌ Cannot create stdin stream: no working microphone device available')
      return null
    }

    // Use pulse format instead of alsa for better compatibility
    let args: string[] = []
    args.push(
      `-f`,
      `f32le`,
      `-ar`,
      `${this.sampleRate}`,
      `-ac`,
      `1`,
      `-i`,
      `-`,
      `-f`,
      `pulse`,  // Changed from alsa to pulse
      `-acodec`,
      `pcm_s16le`,
      device,
    )

    console.log(`🎤 Creating stdin stream for device: ${device}`)
    const process = super.execute(args, () => {
      console.warn(`[play_stdin] Sequence ended`)
    })

    return process?.stdin || null
  }

  public async stop() {
    await super.stop_process()
  }
}

// Video events into camera device
//
// https://github.com/umlaeute/v4l2loopback
// Add user to video group for accessing video device
// sudo usermod -a -G video ubuntu
//
// ___COMMON_ISSUE___ After many attempts or a long time
// [video4linux2,v4l2 @ 0x5581ac5f8ac0] ioctl(VIDIOC_G_FMT): Invalid argument
// Could not write header for output file #0 (incorrect codec parameters ?): Invalid argument
// Error initializing output stream 0:0 --
// Conversion failed!
export class VideoContext extends MediaContext {
  public static instance: VideoContext
  static readonly WIDTH: number = 640
  static readonly HEIGHT: number = 360

  private fps: number
  constructor(fps: number) {
    super()
    this.fps = fps
    VideoContext.instance = this
  }

  public default() {
    VideoContext.instance.play(`../branding.mp4`, true)
  }

  public play(pathname: string, loop: boolean) {
    // ffmpeg -stream_loop -1 -re -i La_bataille_de_Farador.mp4 -f v4l2 -vcodec rawvideo -s 640x360 /dev/video10
    let args: string[] = []
    if (loop) {
      args.push(`-stream_loop`, `-1`)
    }
    args.push(
      `-re`,
      `-i`,
      pathname,
      `-f`,
      `v4l2`,
      `-vcodec`,
      `rawvideo`,
      `-s`,
      `${VideoContext.WIDTH}x${VideoContext.HEIGHT}`,
      CAMERA_DEVICE,
    )
    super.execute(args, this.default)
  }

  public async stop() {
    await super.stop_process()
  }
}
