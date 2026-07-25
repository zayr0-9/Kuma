import { z } from 'zod';

// Two independent policies per root — never one overloaded enum (spec 6.1).
export const PHONE_RETENTION_POLICIES = ['keep_on_phone', 'delete_after_verified_backup'] as const;
export const phoneRetentionPolicySchema = z.enum(PHONE_RETENTION_POLICIES);
export type PhoneRetentionPolicy = z.infer<typeof phoneRetentionPolicySchema>;

export const DESKTOP_DELETION_POLICIES = [
  'preserve_desktop_copy',
  'mirror_user_deletions',
] as const;
export const desktopDeletionPolicySchema = z.enum(DESKTOP_DELETION_POLICIES);
export type DesktopDeletionPolicy = z.infer<typeof desktopDeletionPolicySchema>;

// Every missing/deleted file is assigned a cause (spec 6.2).
export const DELETION_CAUSES = ['retention_cleanup', 'user_or_external_deletion'] as const;
export const deletionCauseSchema = z.enum(DELETION_CAUSES);
export type DeletionCause = z.infer<typeof deletionCauseSchema>;
