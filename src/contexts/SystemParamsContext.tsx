import React, { createContext, useContext, useState, useEffect } from 'react';

interface SystemParams {
  relays: string[];
  exchange_rates: { EUR: number; USD: number; GBP: number };
  split: string;
  version: string;
  updated_at: string;
}

interface SystemParamsContextType {
  params: SystemParams | null;
  isLoading: boolean;
}

const SystemParamsContext = createContext<SystemParamsContextType>({ params: null, isLoading: true });

export const SystemParamsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [params, setParams] = useState<SystemParams | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 5;

    const fetchParams = async () => {
      try {
        const res = await fetch('/api/system-params');
        const data = await res.json();

        if (data.relays && data.relays.length > 0) {
          setParams(data);
          setIsLoading(false);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to fetch system params:', error);
        return false;
      }
    };

    const tryFetch = async () => {
      const success = await fetchParams();
      if (!success && retryCount < maxRetries) {
        retryCount++;
        setTimeout(tryFetch, 5000);
      } else if (!success) {
        setIsLoading(false);
      }
    };

    tryFetch();
  }, []);

  return (
    <SystemParamsContext.Provider value={{ params, isLoading }}>
      {children}
    </SystemParamsContext.Provider>
  );
};

export const useSystemParams = () => useContext(SystemParamsContext);
