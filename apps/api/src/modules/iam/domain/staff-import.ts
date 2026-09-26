/** One row of a staff upload, already cleaned by the request schema. */
export interface StaffImportRow {
  fullName: string;
  email: string;
  phone?: string;
  /** Role code or role name, any case. */
  role: string;
  /** Branch name, any case; empty = no branch. */
  branch?: string;
}

/** The columns of the upload template, in order. */
export const STAFF_IMPORT_COLUMNS = ['full_name', 'email', 'mobile', 'role', 'branch'] as const;
