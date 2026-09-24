/** Notification — public API: the delivery engine, channel providers, the mailer and email templates. */
export * from './application/services/notification.service';
export * from './infrastructure/mail/mailer';
export * from './domain/email-template';
export * from './infrastructure/provider-registry';
export type * from './infrastructure/provider.interface';
