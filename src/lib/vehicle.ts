/** A registration number as the backend stores it: capitals, no spaces or dashes. */
export const normReg = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();

/** State series (RJ14PA1234, DL1C1234) or Bharat series (22BH1234AA). */
export const isRegistration = (v: string) => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v);
