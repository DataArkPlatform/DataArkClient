import { create } from 'zustand'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral'

export interface ToastAction {
  label: string
  onPress?: () => void
}

export interface ToastOptions {
  sub?: string
  action?: ToastAction
}

export interface Toast {
  id: number
  variant: ToastVariant
  message: string
  sub?: string
  action?: ToastAction
}

interface ToastState {
  toasts: Toast[]
  dismiss: (id: number) => void
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
  warning: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  neutral: (message: string, options?: ToastOptions) => void
}

let toastSeq = 0

function createToast(
  variant: ToastVariant,
  message: string,
  options: ToastOptions | undefined
): Toast {
  return { id: ++toastSeq, variant, message, ...options }
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  success: (message, options) =>
    set((state) => ({ toasts: [...state.toasts, createToast('success', message, options)] })),
  error: (message, options) =>
    set((state) => ({ toasts: [...state.toasts, createToast('error', message, options)] })),
  warning: (message, options) =>
    set((state) => ({ toasts: [...state.toasts, createToast('warning', message, options)] })),
  info: (message, options) =>
    set((state) => ({ toasts: [...state.toasts, createToast('info', message, options)] })),
  neutral: (message, options) =>
    set((state) => ({ toasts: [...state.toasts, createToast('neutral', message, options)] }))
}))
