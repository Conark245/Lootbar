import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket(url: string) {
  const [messages, setMessages] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // 1. Proper connection initialization
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    console.log(`[WebSocket] Connecting to ${url}...`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    // 4. Proper event handlers with console logging
    ws.onopen = () => {
      console.log('[WebSocket] Connection opened successfully');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      console.log('[WebSocket] Message received:', event.data);
      setMessages((prev) => [...prev, event.data]);
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Connection failed or error occurred.');
      // readyState will transition to CLOSED and trigger onclose
    };

    ws.onclose = (event) => {
      console.log(`[WebSocket] Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
      setIsConnected(false);
      
      // 3. Auto-reconnect mechanism (reconnects after 3 seconds)
      console.log('[WebSocket] Attempting to reconnect in 3 seconds...');
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };
  }, [url]);

  useEffect(() => {
    connect();

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        // Prevent the close event from triggering a reconnect during component unmount
        wsRef.current.onclose = null; 
        wsRef.current.close();
      }
    };
  }, [connect]);

  // 2. Check readyState === WebSocket.OPEN before sending any data
  const sendMessage = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      wsRef.current.send(payload);
      console.log('[WebSocket] Data sent successfully:', payload);
    } else {
      console.warn('[WebSocket] Cannot send data. Connection is not OPEN. Current state:', wsRef.current?.readyState);
    }
  }, []);

  return { messages, isConnected, sendMessage };
}
