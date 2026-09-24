export const CREW_ROLES = ['driver', 'conductor', 'attendant'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const ATTENDANCE_STATUSES = ['present', 'absent'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
