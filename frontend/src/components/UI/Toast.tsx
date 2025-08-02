import React, { useState, useEffect } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number;
}

interface ToastProps extends ToastMessage {
  onRemove: (id: string) => void;
}

interface ToastContainerProps {
  className?: string;
}

// Individual Toast Component
export function Toast({ id, type, title, message, duration = 5000, onRemove }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    // Show animation
    const showTimer = setTimeout(() => setIsVisible(true), 10);
    
    // Auto-remove timer
    const removeTimer = setTimeout(() => {
      handleRemove();
    }, duration);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(removeTimer);
    };
  }, [duration]);

  const handleRemove = () => {
    setIsRemoving(true);
    setTimeout(() => {
      onRemove(id);
    }, 300); // Animation duration
  };

  const getIcon = () => {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return 'ℹ️';
    }
  };

  return (
    <div 
      className={`toast ${type} ${isVisible ? 'visible' : ''} ${isRemoving ? 'removing' : ''}`}
    >
      <div className="toast-content">
        <div className="toast-icon">
          {getIcon()}
        </div>
        <div className="toast-body">
          <div className="toast-title">{title}</div>
          <div className="toast-message">{message}</div>
        </div>
        <button 
          onClick={handleRemove}
          className="toast-close"
          aria-label="Close notification"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// Global toast state management
class ToastManager {
  private listeners: Array<(toasts: ToastMessage[]) => void> = [];
  private toasts: ToastMessage[] = [];

  subscribe(listener: (toasts: ToastMessage[]) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(listener => listener([...this.toasts]));
  }

  add(toast: Omit<ToastMessage, 'id'>) {
    const newToast: ToastMessage = {
      ...toast,
      id: Math.random().toString(36).substring(2, 9)
    };
    this.toasts.push(newToast);
    this.notify();
    return newToast.id;
  }

  remove(id: string) {
    this.toasts = this.toasts.filter(toast => toast.id !== id);
    this.notify();
  }

  clear() {
    this.toasts = [];
    this.notify();
  }
}

export const toastManager = new ToastManager();

// Toast Container Component
export function ToastContainer({ className = '' }: ToastContainerProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = toastManager.subscribe(setToasts);
    return unsubscribe;
  }, []);

  const handleRemove = (id: string) => {
    toastManager.remove(id);
  };

  if (toasts.length === 0) return null;

  return (
    <div className={`toast-container ${className}`}>
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          {...toast}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

// Convenience functions for showing toasts
export const toast = {
  success: (title: string, message: string, duration?: number) =>
    toastManager.add({ type: 'success', title, message, duration }),
  
  error: (title: string, message: string, duration?: number) =>
    toastManager.add({ type: 'error', title, message, duration }),
  
  warning: (title: string, message: string, duration?: number) =>
    toastManager.add({ type: 'warning', title, message, duration }),
  
  info: (title: string, message: string, duration?: number) =>
    toastManager.add({ type: 'info', title, message, duration }),
};

export default ToastContainer;