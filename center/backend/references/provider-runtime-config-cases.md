# Model runtime configuration regression cases

These cases document the ground truth used by the runtime configuration tests.

1. When an existing model runtime row has version `4` and the management client omits
   `runtimeRowVersion`, the service must preserve the stored credential and write
   with expected version `4` instead of attempting an insert.
2. When the persistence adapter reports `PROVIDER_RUNTIME_CONFIG_CONFLICT`, the
   API contract must return HTTP `409` with the same machine-readable code.
3. The API response may report whether a credential exists, but must never return
   the plaintext credential or its ciphertext.
