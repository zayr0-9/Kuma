package expo.modules.foldersync

import android.util.Base64
import okhttp3.OkHttpClient
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

// Spike 4 (spec 24.4, agent_native): trust ONLY the desktop's pinned key. This is NOT a
// trust-all path — exactly one SubjectPublicKeyInfo is accepted; every other certificate
// throws. The pin is base64url(SHA-256(SPKI-DER)), computed identically to the desktop
// (apps/desktop/src/main/auth/identity.ts) and carried in the pairing QR.
//
// OkHttp's CertificatePinner cannot do this for a self-signed cert: it runs only AFTER the
// default CA TrustManager validates the chain, which a self-signed cert fails first — so the
// pin is never consulted. We therefore replace the trust anchor with this single-key manager.
class SpkiPinningTrustManager(expectedPinBase64Url: String) : X509TrustManager {
  // The 43-char base64url QR pin decodes to the raw 32-byte SHA-256(SPKI) target.
  private val expected: ByteArray =
    Base64.decode(expectedPinBase64Url, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf = chain?.firstOrNull() ?: throw CertificateException("No certificate presented")
    // getPublicKey().getEncoded() is the DER of the SubjectPublicKeyInfo — byte-for-byte the
    // same input the desktop hashes (exportKey('spki') / certificate.publicKey.rawData).
    val actual = MessageDigest.getInstance("SHA-256").digest(leaf.publicKey.encoded)
    // MessageDigest.isEqual is constant-time on modern Android — do not use Arrays.equals.
    if (!MessageDigest.isEqual(actual, expected)) {
      throw CertificateException("Server key does not match the pinned desktop identity")
    }
    // Match: this IS the paired desktop. No CA path and no expiry check — the key is the
    // identity (a TOFU/known-hosts model), which is exactly the desktop's design.
  }

  // Client (mutual-TLS) auth is never used on this path — be strict, never trust-all.
  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    throw CertificateException("Client authentication is not supported")
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

// The pinned trust materials, built once from a QR pin and shared by BOTH transports that
// talk to the desktop: OkHttp (the control-protocol JSON calls) and HttpsURLConnection (the
// tus byte upload, spec 18.2). One trust decision — the SPKI pin — for every connection.
class PinnedSsl(expectedPinBase64Url: String) {
  val trustManager: X509TrustManager = SpkiPinningTrustManager(expectedPinBase64Url)
  val socketFactory: SSLSocketFactory =
    SSLContext.getInstance("TLS").apply {
      init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
    }.socketFactory
}

// Hostname verification is bypassed on purpose and this is NOT trust-all: the trust decision
// is the SPKI pin above, so an attacker spoofing the same host:port cannot present a
// certificate with the pinned key without the desktop's private key. The self-signed cert is
// CN=FolderSync <uuid> with no IP SAN, so a name check would always fail; returning true only
// drops that redundant check once the key is pinned. Keep this coupled to the pinned trust
// manager — weakening either half opens a hole. Shared by the OkHttp and tus paths alike.
val ALLOW_PINNED_HOSTNAME = HostnameVerifier { _, _ -> true }

fun pinnedHttpClient(expectedPinBase64Url: String): OkHttpClient {
  val ssl = PinnedSsl(expectedPinBase64Url)
  return OkHttpClient.Builder()
    .sslSocketFactory(ssl.socketFactory, ssl.trustManager)
    .hostnameVerifier(ALLOW_PINNED_HOSTNAME)
    .build()
}
