/**
 * Network Status Monitoring Hook
 * Monitors online/offline status and provides network health information
 */

import { useState, useEffect, useCallback } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  lastOnlineTime: number | null;
  lastOfflineTime: number | null;
  connectionType: string;
  effectiveType: string;
  downlink: number;
  rtt: number;
}

export const useNetworkStatus = () => {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    wasOffline: false,
    lastOnlineTime: null,
    lastOfflineTime: null,
    connectionType: 'unknown',
    effectiveType: 'unknown',
    downlink: 0,
    rtt: 0,
  });

  const updateNetworkStatus = useCallback(() => {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const now = Date.now();
    
    // Get connection information if available
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    
    setNetworkStatus(prev => ({
      isOnline,
      wasOffline: prev.wasOffline || (!isOnline && prev.isOnline),
      lastOnlineTime: isOnline ? now : prev.lastOnlineTime,
      lastOfflineTime: !isOnline ? now : prev.lastOfflineTime,
      connectionType: connection?.type || 'unknown',
      effectiveType: connection?.effectiveType || 'unknown',
      downlink: connection?.downlink || 0,
      rtt: connection?.rtt || 0,
    }));
  }, []);

  useEffect(() => {
    // Initial check
    updateNetworkStatus();

    // Set up event listeners
    const handleOnline = () => {
      updateNetworkStatus();
    };

    const handleOffline = () => {
      updateNetworkStatus();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      
      // Listen for connection changes if available
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (connection) {
        connection.addEventListener('change', updateNetworkStatus);
      }

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        if (connection) {
          connection.removeEventListener('change', updateNetworkStatus);
        }
      };
    }
  }, [updateNetworkStatus]);

  // Check backend connectivity
  const checkBackendConnectivity = useCallback(async (backendUrl: string = '/health'): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(backendUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.warn('Backend connectivity check failed:', error);
      return false;
    }
  }, []);

  return {
    ...networkStatus,
    checkBackendConnectivity,
    isSlowConnection: networkStatus.effectiveType === 'slow-2g' || networkStatus.effectiveType === '2g',
    isUnstableConnection: networkStatus.rtt > 200 || networkStatus.downlink < 1.5,
  };
};
