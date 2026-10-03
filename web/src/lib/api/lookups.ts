import { get } from './client';

/** What a PIN code tells a form: its city, state, localities — and the platform's city id, if it has that city. */
export interface PincodeInfo {
  pincode: string;
  city: string;
  district: string;
  state: string;
  localities: string[];
  cityId: string | null;
}

/** What an IFSC tells a form: the bank always; branch, address and city when the directory answers. */
export interface IfscInfo {
  ifsc: string;
  bankCode: string;
  bank: string;
  branch: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
}

export const PINCODE_RE = /^[1-9]\d{5}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const lookupsApi = {
  pincode: (pin: string) => get<PincodeInfo>(`/v1/master-data/lookups/pincode/${encodeURIComponent(pin)}`),
  ifsc: (code: string) => get<IfscInfo>(`/v1/master-data/lookups/ifsc/${encodeURIComponent(code)}`),
};
