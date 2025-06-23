import { Browser, BrowserContext, Page } from '@playwright/test'

export type Meeting = {
    page: Page
    backgroundPage: Page
    browser: Browser
    meetingTimeoutInterval: NodeJS.Timeout
}

export type SpeechToTextProvider = 'Default' | 'Gladia' | 'RunPod'
export type RecordingMode = 'speaker_view' | 'gallery_view' | 'audio_only'

export interface MeetingProviderInterface {
    openMeetingPage(
        browserContext: BrowserContext,
        link: string,
        streaming_input: string | undefined,
    ): Promise<Page>
    joinMeeting(
        page: Page,
        cancelCheck: () => boolean,
        meetingParams: MeetingParams,
        onJoinSuccess: () => void,
    ): Promise<void>
    findEndMeeting(
        meetingParams: MeetingParams,
        page: Page,
        // cancellationToken: CancellationToken,
    ): Promise<boolean>
    parseMeetingUrl(
        meeting_url: string,
    ): Promise<{ meetingId: string; password: string }>
    getMeetingLink(
        meeting_id: string,
        _password: string,
        _role: number,
        _bot_name: string,
        _enter_message?: string,
    ): string
    closeMeeting(page: Page): Promise<void>
}

export type MeetingParams = {
    id: string
    use_my_vocabulary: boolean
    meeting_url: string
    user_token: string
    bot_name: string
    user_id: number
    session_id: string
    email: string
    meetingProvider: MeetingProvider
    event?: { id: number }
    agenda?: any
    bot_branding: boolean
    custom_branding_bot_path?: string
    vocabulary: string[]
    force_lang: boolean
    translation_lang?: string
    speech_to_text_provider?: SpeechToTextProvider
    speech_to_text_api_key?: string
    streaming_input?: string
    streaming_output?: string
    streaming_audio_frequency?: number
    bot_uuid: string
    enter_message?: string
    bots_api_key: string
    bots_webhook_url?: string
    recording_mode: RecordingMode
    local_recording_server_location: string
    automatic_leave: {
        // The number of seconds after which the bot will automatically leave the call, if it has not been let in from the waiting room.
        waiting_room_timeout: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the meeting but no other participant has joined.
        noone_joined_timeout: number
        // The number of seconds after which the bot will automatically leave the call, if there were other participants in the call who have all left.
        // everyone_left_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call but not started recording.
        // in_call_not_recording_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call and started recording it. This can be used to enforce a maximum recording time limit for a bot. There is no default value for this parameter, meaning a bot will continue to record for as long as the meeting lasts.
        // in_call_recording_timeout?: number
        // The number of seconds after which the bot will automatically leave the call, if it has joined the call but has not started recording. For e.g This can occur due to bot being denied permission to record(Zoom meetings).
        // recording_permission_denied_timeout?: number
    }
    mp4_s3_path: string
    secret: string
    extra?: any
    zoom_sdk_id?: string
    zoom_sdk_pwd?: string
}

export class CancellationToken {
    isCancellationRequested: boolean
    timeInSec: number
    timeout: NodeJS.Timeout
    constructor(timeInSec: number) {
        this.isCancellationRequested = false
        this.timeInSec = timeInSec
        this.timeout = setTimeout(() => this.cancel(), this.timeInSec * 1000)
    }
    cancel() {
        this.isCancellationRequested = true
    }
    reset() {
        clearTimeout(this.timeout)
        this.timeout = setTimeout(() => this.cancel(), this.timeInSec * 1000)
    }
}

export type StopRecordParams = {
    meeting_url: string
    user_id: number
}

export type SpeakerData = {
    name: string
    id: number
    timestamp: number
    isSpeaking: boolean
}
export type MeetingProvider = 'Meet' | 'Teams' | 'Zoom'

export enum RecordingApprovalState {
    WAITING = 'WAITING',
    ENABLE = 'ENABLE',
    DISABLE = 'DISABLE',
}

export class JoinError extends Error {
    details?: any

    constructor(message: string, details?: any) {
        super(message)
        this.name = 'JoinError'
        this.details = details
    }
}

export enum JoinErrorCode {
    CannotJoinMeeting = 'CannotJoinMeeting',
    BotNotAccepted = 'BotNotAccepted',
    BotRemoved = 'BotRemoved',
    ApiRequest = 'ApiRequest',
    TimeoutWaitingToStart = 'TimeoutWaitingToStart',
    Internal = 'InternalError classic',
    InvalidMeetingUrl = 'InvalidMeetingUrl',
    StreamingSetupFailed = 'StreamingSetupFailed',
}
