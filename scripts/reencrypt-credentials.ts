/**
 * `npm run secrets:reencrypt` — after rotating APP_ENCRYPTION_KEY, re-encrypt every
 * workspace's stored MDM credential with the new key so the old key can be retired.
 * Prints counts only; never prints a credential. See docs/deployment.md, "Rotating the encryption key".
 */
import { reencryptCredentials } from "../src/server/crypto/rotate";

const version = Number(process.env.APP_ENCRYPTION_KEY_VERSION ?? 1);
reencryptCredentials(version)
  .then((r) => {
    console.log(`Re-encrypted ${r.reencrypted}, already on key version ${version}: ${r.alreadyCurrent}, could not decrypt: ${r.failed.length} credentials and ${r.customersFailed} orders' customer details`);
    if (r.failed.length) {
      console.log(`Connections that need their key re-entered in Settings: ${r.failed.join(", ")}`);
      process.exit(2);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error("Re-encryption failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
