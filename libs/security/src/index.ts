/**
 * @security — cryptography, hashing, tokens and access control primitives.
 *
 * All crypto lives here so the security-sensitive code exists in exactly one
 * place and can be audited as a unit. Higher-level auth *policy* (login flows,
 * session lifecycle, RBAC evaluation) lives in the IAM feature module and
 * consumes these primitives.
 */
export * from './crypto-utils';
export * from './password-hasher';
export * from './field-encryptor';
export * from './token-service';
export * from './otp-service';
export * from './security.module';
