import React from 'react';

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
  text?: string;
}

export function LoadingSpinner({ 
  size = 'medium', 
  className = '',
  text 
}: LoadingSpinnerProps) {
  return (
    <div className={`loading-spinner ${size} ${className}`}>
      <div className="spinner">
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
        <div className="spinner-ring"></div>
      </div>
      {text && <div className="loading-text">{text}</div>}
    </div>
  );
}

export default LoadingSpinner;