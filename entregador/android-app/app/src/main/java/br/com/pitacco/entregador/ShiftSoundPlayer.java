package br.com.pitacco.entregador;

import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

/**
 * Explicitly enabled courier Shift Sound. During one short alert only, raises
 * either the media or alarm stream, then restores the previous volume. Does not
 * change ringer mode, mute status, Do Not Disturb settings, or user audio policy.
 *
 * A volume override can be rejected by Android. Never claim the alert was heard.
 */
public final class ShiftSoundPlayer {
    private static final String PREFS = "pitacco_delivery_shift_sound";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_RESTORE_PENDING = "restore_pending";
    private static final String KEY_STREAM = "volume_stream";
    private static final String KEY_ORIGINAL = "original_volume";
    private static final String KEY_TEMPORARY = "temporary_volume";
    private static final Handler HANDLER = new Handler(Looper.getMainLooper());
    private static MediaPlayer player;
    private static AudioManager volumeManager;
    private static Context playingContext;
    private static int originalVolume = -1;
    private static int temporaryVolume = -1;
    private static int streamType = -1;
    private static String lastResult = "off";
    private static Runnable timeoutTask;

    private ShiftSoundPlayer() {}

    private static SharedPreferences settings(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean isEnabled(Context context) {
        return settings(context).getBoolean(KEY_ENABLED, false);
    }

    public static synchronized void setEnabled(Context context, boolean enabled) {
        if (!enabled) stopAndRestore();
        settings(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
        lastResult = enabled ? "ready" : "off";
    }

    public static synchronized String getLastResult() { return lastResult; }

    private static void clearPending(Context context) {
        settings(context).edit().remove(KEY_RESTORE_PENDING).remove(KEY_STREAM)
                .remove(KEY_ORIGINAL).remove(KEY_TEMPORARY).commit();
    }

    /** Recover after process death; restore only if the user has not changed volume. */
    public static synchronized void recover(Context context) {
        SharedPreferences prefs = settings(context);
        if (!prefs.getBoolean(KEY_RESTORE_PENDING, false)) return;
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        int stream = prefs.getInt(KEY_STREAM, -1);
        int old = prefs.getInt(KEY_ORIGINAL, -1);
        int raised = prefs.getInt(KEY_TEMPORARY, -1);
        if (manager != null && (stream == AudioManager.STREAM_ALARM ||
                stream == AudioManager.STREAM_MUSIC) && old >= 0 && raised >= 0) {
            try {
                if (manager.getStreamVolume(stream) == raised)
                    manager.setStreamVolume(stream, old, 0);
            } catch (SecurityException | IllegalArgumentException ignored) {}
        }
        clearPending(context);
    }

    private static synchronized void stopAndRestore() {
        if (timeoutTask != null) {
            HANDLER.removeCallbacks(timeoutTask);
            timeoutTask = null;
        }
        if (player != null) {
            try { player.stop(); } catch (IllegalStateException ignored) {}
            try { player.release(); } catch (RuntimeException ignored) {}
            player = null;
        }
        if (volumeManager != null && streamType >= 0 &&
                originalVolume >= 0 && temporaryVolume >= 0) {
            try {
                // Never override a volume adjustment made by the user meanwhile.
                if (volumeManager.getStreamVolume(streamType) == temporaryVolume)
                    volumeManager.setStreamVolume(streamType, originalVolume, 0);
            } catch (SecurityException | IllegalArgumentException ignored) {}
        }
        if (playingContext != null) clearPending(playingContext);
        volumeManager = null;
        playingContext = null;
        originalVolume = -1;
        temporaryVolume = -1;
        streamType = -1;
    }

    /**
     * Selects a temporary stream level for this alert. The media stream is
     * preferred with silent/vibrate ringer mode; ALARM is preferred in normal
     * mode. Both belong to the explicitly opted-in Shift Sound behavior.
     */
    private static boolean raiseForAlert(Context app, AudioManager manager, int stream) {
        int before;
        int target;
        try {
            before = manager.getStreamVolume(stream);
            target = Math.max(before, Math.max(1,
                    (int) Math.ceil(manager.getStreamMaxVolume(stream) * .90)));
            if (before == target && !manager.isStreamMute(stream)) {
                streamType = stream;
                volumeManager = manager;
                playingContext = app;
                return true;
            }
            // Persist recovery data before touching global system audio.
            boolean saved = settings(app).edit()
                    .putBoolean(KEY_RESTORE_PENDING, true)
                    .putInt(KEY_STREAM, stream)
                    .putInt(KEY_ORIGINAL, before)
                    .putInt(KEY_TEMPORARY, target).commit();
            if (!saved) return false;
            manager.setStreamVolume(stream, target, 0);
            int after = manager.getStreamVolume(stream);
            if (after < target || manager.isStreamMute(stream)) {
                if (after == target) manager.setStreamVolume(stream, before, 0);
                clearPending(app);
                return false;
            }
            originalVolume = before;
            temporaryVolume = target;
            streamType = stream;
            volumeManager = manager;
            playingContext = app;
            return true;
        } catch (SecurityException | IllegalArgumentException error) {
            // Do not fight Android's interruption or volume restrictions.
            recover(app);
            return false;
        }
    }

    /**
     * Sends the bundled bell + optional courier voice to a permitted audio
     * stream. Does not claim that the physical speaker produced audible sound.
     */
    public static synchronized String play(Context context) {
        if (!isEnabled(context)) return (lastResult = "off");
        stopAndRestore();
        Context app = context.getApplicationContext();
        NotificationManager notifications = (NotificationManager)
                app.getSystemService(Context.NOTIFICATION_SERVICE);
        int interruption = notifications == null
                ? NotificationManager.INTERRUPTION_FILTER_UNKNOWN
                : notifications.getCurrentInterruptionFilter();
        if (interruption == NotificationManager.INTERRUPTION_FILTER_NONE)
            return (lastResult = "blocked_dnd");

        AudioManager manager = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (manager == null) return (lastResult = "audio_unavailable");

        boolean dndNormal = interruption == NotificationManager.INTERRUPTION_FILTER_ALL;
        boolean ringerSilent = manager.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
        // Media may be audible with the ringer muted; do not use media as a way
        // around an active restricted Do Not Disturb policy.
        int preferred = ringerSilent && dndNormal
                ? AudioManager.STREAM_MUSIC : AudioManager.STREAM_ALARM;
        int alternative = preferred == AudioManager.STREAM_MUSIC
                ? AudioManager.STREAM_ALARM : AudioManager.STREAM_MUSIC;
        boolean ready = raiseForAlert(app, manager, preferred);
        if (!ready && dndNormal) ready = raiseForAlert(app, manager, alternative);
        if (!ready) return (lastResult = dndNormal ? "volume_restricted" : "blocked_dnd");

        int audioStream = streamType;
        try {
            Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://"
                    + app.getPackageName() + "/raw/pitacco_assignment");
            MediaPlayer instance = new MediaPlayer();
            instance.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(audioStream == AudioManager.STREAM_MUSIC ?
                            AudioAttributes.USAGE_MEDIA : AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player = instance;
            instance.setDataSource(app, sound);
            instance.setVolume(1f, 1f);
            instance.setOnCompletionListener(mp -> stopAndRestore());
            instance.setOnErrorListener((mp, what, extra) -> {
                stopAndRestore();
                return true;
            });
            instance.prepare();
            int playbackTimeMs = instance.getDuration();
            instance.start();
            timeoutTask = ShiftSoundPlayer::stopAndRestore;
            HANDLER.postDelayed(timeoutTask, Math.max(3100,
                    Math.min(14500, playbackTimeMs > 0 ? playbackTimeMs + 1200 : 3100)));
            return (lastResult = audioStream == AudioManager.STREAM_MUSIC ?
                    "started_media" : "started_alarm");
        } catch (Exception error) {
            stopAndRestore();
            return (lastResult = "playback_failed");
        }
    }
}
