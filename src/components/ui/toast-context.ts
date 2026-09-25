import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast { id: number; kind: ToastKind; message: string }

export interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  push: () => {}, success: () => {}, error: () => {}, info: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
