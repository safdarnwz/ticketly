export const CREW_ROLES = ['driver', 'conductor', 'attendant'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const ATTENDANCE_STATUSES = ['present', 'absent'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const CREW_STATUSES = ['active', 'on_leave', 'inactive'] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];
