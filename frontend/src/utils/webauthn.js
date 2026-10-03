import { useState, useEffect } from 'react';
import client from '../api/client';

/**
 * Fingerprint via the device's own sensor (Windows Hello / Touch ID / Android),
 * using WebAuthn platform authenticators. No external scanner needed.
 */

export const b64urlEncode = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const b64urlDecode = (str) => {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

/** Resolves true only if this device has a usable fingerprint/biometric sensor. */
export const isFingerprintAvailable = async () => {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

/** null = still checking, true/false = result */
export const useFingerprintSupport = () => {
  const [supported, setSupported] = useState(null);
  useEffect(() => {
    let active = true;
    isFingerprintAvailable().then((ok) => active && setSupported(ok));
    return () => { active = false; };
  }, []);
  return supported;
};

/** Enroll: prompts the device sensor and registers the credential for a student. */
export const enrollFingerprint = async (studentId, displayName) => {
  const { data } = await client.get('/enrollment/fingerprint-challenge');
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: b64urlDecode(data.challenge),
      rp: { name: 'Multi-Modal Attendance' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: `student_${studentId}`,
        displayName: displayName || `Student ${studentId}`,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // built-in sensor only
        userVerification: 'required',        // must actually scan the fingerprint
        residentKey: 'discouraged',
      },
      attestation: 'none',
      timeout: 60000,
    },
  });
  const publicKey = credential.response.getPublicKey?.();
  if (!publicKey) throw new Error('This browser cannot export the fingerprint credential key.');
  await client.post(`/enrollment/fingerprint/${studentId}`, {
    credential_id: b64urlEncode(credential.rawId),
    public_key: b64urlEncode(publicKey),
    client_data_json: b64urlEncode(credential.response.clientDataJSON),
  });
};

/**
 * Verify: prompts the device sensor. Returns the signed assertion to send to
 * /attendance/verify/multimodal, or null if nobody has enrolled a fingerprint.
 */
export const scanFingerprint = async () => {
  const { data } = await client.get('/attendance/fingerprint-challenge');
  if (!data.enrolled) return null;
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: b64urlDecode(data.challenge),
      allowCredentials: data.allow_credentials.map((id) => ({
        type: 'public-key',
        id: b64urlDecode(id),
        transports: ['internal'],
      })),
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return {
    credential_id: b64urlEncode(assertion.rawId),
    authenticator_data: b64urlEncode(assertion.response.authenticatorData),
    client_data_json: b64urlEncode(assertion.response.clientDataJSON),
    signature: b64urlEncode(assertion.response.signature),
  };
};
