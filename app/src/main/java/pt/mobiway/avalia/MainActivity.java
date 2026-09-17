package pt.mobiway.avalia;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 1001;
    private static final int CAMERA_PERMISSION = 2001;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private boolean cameraRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(9, 10, 12));
        getWindow().setNavigationBarColor(Color.rgb(9, 10, 12));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 10, 12));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void printPdf() {
                runOnUiThread(() -> createPrintJob());
            }
        }, "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("file".equals(u.getScheme())) return false;
                openExternal(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(
                    "window.print=function(){if(window.AndroidBridge&&AndroidBridge.printPdf){AndroidBridge.printPdf();}};",
                    null
                );
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {

                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }

                fileCallback = callback;

                boolean capturePreferred =
                    params != null && params.isCaptureEnabled();

                launchChooser(capturePreferred);
                return true;
            }

            @Override
            public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    android.os.Message resultMsg) {

                WebView temp = new WebView(MainActivity.this);

                temp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(
                            WebView v,
                            WebResourceRequest req) {
                        openExternal(req.getUrl());
                        return true;
                    }
                });

                WebView.WebViewTransport transport =
                    (WebView.WebViewTransport) resultMsg.obj;

                transport.setWebView(temp);
                resultMsg.sendToTarget();
                return true;
            }
        });

        if (android.os.Build.VERSION.SDK_INT >= 23 &&
                checkSelfPermission(Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {

            requestPermissions(
                new String[]{Manifest.permission.CAMERA},
                CAMERA_PERMISSION
            );
        }

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void launchChooser(boolean capturePreferred) {
        cameraRequest = capturePreferred;

        if (capturePreferred) {
            launchCamera();
            return;
        }

        Intent gallery = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        gallery.addCategory(Intent.CATEGORY_OPENABLE);
        gallery.setType("image/*");
        gallery.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        gallery.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            startActivityForResult(gallery, FILE_CHOOSER);

        } catch (ActivityNotFoundException ex) {

            Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
            fallback.addCategory(Intent.CATEGORY_OPENABLE);
            fallback.setType("image/*");
            fallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

            try {
                startActivityForResult(
                    Intent.createChooser(
                        fallback,
                        "Fotografias da viatura"
                    ),
                    FILE_CHOOSER
                );

            } catch (ActivityNotFoundException ignored) {
                finishFileChooser(null);
            }
        }
    }

    private void launchCamera() {
        Intent camera =
            new Intent(MediaStore.ACTION_IMAGE_CAPTURE);

        ContentValues values = new ContentValues();

        values.put(
            MediaStore.Images.Media.DISPLAY_NAME,
            "mobiway_" + System.currentTimeMillis() + ".jpg"
        );

        values.put(
            MediaStore.Images.Media.MIME_TYPE,
            "image/jpeg"
        );

        cameraUri =
            getContentResolver().insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                values
            );

        if (cameraUri != null) {
            camera.putExtra(
                MediaStore.EXTRA_OUTPUT,
                cameraUri
            );

            camera.addFlags(
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        }

        try {
            startActivityForResult(camera, FILE_CHOOSER);

        } catch (ActivityNotFoundException ex) {
            finishFileChooser(null);
        }
    }

    private void createPrintJob() {
        if (webView == null) return;

        PrintManager printManager =
            (PrintManager) getSystemService(PRINT_SERVICE);

        if (printManager == null) return;

        PrintDocumentAdapter adapter =
            webView.createPrintDocumentAdapter(
                "MOBIWAY Avalia"
            );

        printManager.print(
            "MOBIWAY Avalia",
            adapter,
            new PrintAttributes.Builder().build()
        );
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(
                new Intent(Intent.ACTION_VIEW, uri)
            );
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            Intent data) {

        super.onActivityResult(
            requestCode,
            resultCode,
            data
        );

        if (requestCode != FILE_CHOOSER ||
                fileCallback == null) {
            return;
        }

        if (resultCode != RESULT_OK) {
            finishFileChooser(null);
            return;
        }

        List<Uri> uris = new ArrayList<>();

        if (data != null) {

            ClipData clipData = data.getClipData();

            if (clipData != null) {

                for (int i = 0;
                     i < clipData.getItemCount();
                     i++) {

                    Uri uri =
                        clipData.getItemAt(i).getUri();

                    if (uri != null) {
                        uris.add(uri);
                    }
                }

            } else if (data.getData() != null) {

                uris.add(data.getData());
            }
        }

        if (uris.isEmpty() &&
                cameraRequest &&
                cameraUri != null) {

            uris.add(cameraUri);
        }

        finishFileChooser(
            uris.isEmpty()
                ? null
                : uris.toArray(new Uri[0])
        );
    }

    private void finishFileChooser(Uri[] result) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }

        cameraUri = null;
        cameraRequest = false;
    }

    @Override
    public void onBackPressed() {
        if (webView != null &&
                webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
