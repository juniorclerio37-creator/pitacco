package br.com.pitacco.entregador;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.google.android.gms.location.ActivityRecognitionResult;
import com.google.android.gms.location.DetectedActivity;

/**
 * Activity Recognition updates during an explicitly started courier shift.
 * An explicit, non-exported receiver prevents other apps sending fake events.
 * Sensor classification is advisory; it never claims an exact motorcycle
 * versus car or substitutes for a fresh/accurate GPS reading.
 */
public final class CourierMotionReceiver extends BroadcastReceiver {
    static final String ACTION_UPDATE = "br.com.pitacco.entregador.MOTION_UPDATE";

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_UPDATE.equals(intent.getAction())
                || !CourierLocationService.isRunning()
                || !ActivityRecognitionResult.hasResult(intent)) return;
        ActivityRecognitionResult result = ActivityRecognitionResult.extractResult(intent);
        if (result == null) return;
        DetectedActivity detected = result.getMostProbableActivity();
        if (detected == null) return;
        int confidence = detected.getConfidence();
        if (confidence < 65 || confidence > 100) return;
        String state;
        switch (detected.getType()) {
            case DetectedActivity.STILL:
                state = "stopped";
                break;
            case DetectedActivity.ON_BICYCLE:
            case DetectedActivity.IN_VEHICLE:
            case DetectedActivity.ON_FOOT:
            case DetectedActivity.WALKING:
            case DetectedActivity.RUNNING:
                state = "moving";
                break;
            default:
                state = "unknown";
        }
        CourierLocationService.recordPhysicalActivity(state, confidence);
    }
}
