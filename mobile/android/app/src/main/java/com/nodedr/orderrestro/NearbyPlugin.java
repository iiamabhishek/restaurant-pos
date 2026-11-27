package com.nodedr.orderrestro;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import java.nio.charset.StandardCharsets;

/**
 * Phone-to-phone link with no router, internet or server, over Google's Nearby Connections (Bluetooth / Wi-Fi
 * Direct, chosen by Google Play services). This class only moves bytes; who may talk, what is exchanged and
 * what counts as safely received is decided in www/pos/lib/nearby.js.
 *
 * Limits, stated plainly: Android with Google Play services only, roughly 100 m in the open, both phones must
 * keep the app open on this screen, and one payload is at most 32 KB (ConnectionsClient.MAX_BYTES_DATA_SIZE).
 * Every connection shows the same 4-digit code on both phones; the JS layer refuses to send anything until a
 * person has confirmed they match, which is what defeats a stranger's phone joining.
 */
@CapacitorPlugin(
    name = "Nearby",
    permissions = {
        // Android 11 and older
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "nearbyLegacy"),
        // Android 12 and 12L
        @Permission(
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_FINE_LOCATION
            },
            alias = "nearby12"
        ),
        // Android 13 and newer
        @Permission(
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                "android.permission.NEARBY_WIFI_DEVICES"
            },
            alias = "nearby13"
        )
    }
)
public class NearbyPlugin extends Plugin {

    static final String SERVICE_ID = "com.nodedr.orderrestro.nearby";
    static final int MAX_PAYLOAD = ConnectionsClient.MAX_BYTES_DATA_SIZE;

    private ConnectionsClient client;
    private boolean running = false;
    private String localName = "Phone";

    private String alias() {
        if (Build.VERSION.SDK_INT >= 33) return "nearby13";
        if (Build.VERSION.SDK_INT >= 31) return "nearby12";
        return "nearbyLegacy";
    }

    private ConnectionsClient client() {
        if (client == null) client = Nearby.getConnectionsClient(getContext());
        return client;
    }

    private boolean playServicesOk() {
        return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", playServicesOk());
        r.put("permission", getPermissionState(alias()).toString().toLowerCase());
        r.put("running", running);
        r.put("maxPayload", MAX_PAYLOAD);
        call.resolve(r);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (getPermissionState(alias()).toString().equalsIgnoreCase("granted")) {
            status(call);
            return;
        }
        requestPermissionForAlias(alias(), call, "accessResult");
    }

    @PermissionCallback
    private void accessResult(PluginCall call) {
        status(call);
    }

    /** Advertise and look for other phones running this app. */
    @PluginMethod
    public void start(PluginCall call) {
        if (!playServicesOk()) {
            call.reject("Google Play services is not available on this phone, so Nearby cannot be used.", "NO_PLAY_SERVICES");
            return;
        }
        if (!getPermissionState(alias()).toString().equalsIgnoreCase("granted")) {
            call.reject("Allow \"Nearby devices\" for OrderRestro first.", "NO_PERMISSION");
            return;
        }
        String n = call.getString("name", "Phone");
        localName = n == null || n.trim().isEmpty() ? "Phone" : n.trim();
        if (localName.length() > 40) localName = localName.substring(0, 40);
        stopAll();
        AdvertisingOptions adv = new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build();
        DiscoveryOptions disc = new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build();
        client()
            .startAdvertising(localName, SERVICE_ID, lifecycle, adv)
            .addOnSuccessListener(v ->
                client()
                    .startDiscovery(SERVICE_ID, discovery, disc)
                    .addOnSuccessListener(w -> {
                        running = true;
                        call.resolve();
                    })
                    .addOnFailureListener(e -> {
                        stopAll();
                        call.reject("Could not look for nearby phones: " + e.getMessage(), "DISCOVERY_FAILED");
                    })
            )
            .addOnFailureListener(e -> call.reject("Could not start Nearby: " + e.getMessage(), "ADVERTISE_FAILED"));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopAll();
        call.resolve();
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        client()
            .requestConnection(localName, id, lifecycle)
            .addOnSuccessListener(v -> call.resolve())
            .addOnFailureListener(e -> call.reject("Could not connect: " + e.getMessage(), "CONNECT_FAILED"));
    }

    /** Called only after the person confirmed the 4-digit code matches on both phones. */
    @PluginMethod
    public void accept(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        client()
            .acceptConnection(id, payloads)
            .addOnSuccessListener(v -> call.resolve())
            .addOnFailureListener(e -> call.reject("Could not accept: " + e.getMessage(), "ACCEPT_FAILED"));
    }

    @PluginMethod
    public void reject(PluginCall call) {
        String id = call.getString("id");
        if (id != null) client().rejectConnection(id);
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String id = call.getString("id");
        if (id != null) client().disconnectFromEndpoint(id);
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String id = call.getString("id");
        String text = call.getString("text");
        if (id == null || text == null) {
            call.reject("id and text are required");
            return;
        }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_PAYLOAD) {
            call.reject("That message is too large to send (" + bytes.length + " bytes).", "TOO_LARGE");
            return;
        }
        client()
            .sendPayload(id, Payload.fromBytes(bytes))
            .addOnSuccessListener(v -> call.resolve())
            .addOnFailureListener(e -> call.reject("Could not send: " + e.getMessage(), "SEND_FAILED"));
    }

    @Override
    protected void handleOnDestroy() {
        stopAll();
        super.handleOnDestroy();
    }

    private void stopAll() {
        running = false;
        if (client == null) return;
        client.stopAdvertising();
        client.stopDiscovery();
        client.stopAllEndpoints();
    }

    private final EndpointDiscoveryCallback discovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String id, DiscoveredEndpointInfo info) {
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("name", info.getEndpointName());
            notifyListeners("peerFound", o);
        }

        @Override
        public void onEndpointLost(String id) {
            JSObject o = new JSObject();
            o.put("id", id);
            notifyListeners("peerLost", o);
        }
    };

    private final ConnectionLifecycleCallback lifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String id, ConnectionInfo info) {
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("name", info.getEndpointName());
            o.put("code", info.getAuthenticationDigits());
            o.put("incoming", info.isIncomingConnection());
            notifyListeners("connectionRequest", o);
        }

        @Override
        public void onConnectionResult(String id, ConnectionResolution result) {
            JSObject o = new JSObject();
            o.put("id", id);
            int code = result.getStatus().getStatusCode();
            o.put("ok", code == ConnectionsStatusCodes.STATUS_OK);
            o.put("rejected", code == ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED);
            notifyListeners("connectionResult", o);
        }

        @Override
        public void onDisconnected(String id) {
            JSObject o = new JSObject();
            o.put("id", id);
            notifyListeners("disconnected", o);
        }
    };

    private final PayloadCallback payloads = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String id, Payload payload) {
            if (payload.getType() != Payload.Type.BYTES || payload.asBytes() == null) return;
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("text", new String(payload.asBytes(), StandardCharsets.UTF_8));
            notifyListeners("payload", o);
        }

        @Override
        public void onPayloadTransferUpdate(String id, PayloadTransferUpdate update) {}
    };
}
