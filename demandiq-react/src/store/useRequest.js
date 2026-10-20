// Loads data that only one page or panel needs, straight from a service: { data, error, loading, reload }.
//
//   const { data, error, loading, reload } = useRequest(() => dashboardService.getSummary(filters), [filtersKey]);
//
// The request runs again when a value in `deps` changes or reload() is called. While it reloads, the
// previous data stays on screen; an answer that arrives after the page moved on is ignored.
import { useEffect, useState } from "react";
import { settle } from "../services/api";

export function useRequest(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    settle(load()).then((result) => {
      if (!active) return;
      setState((current) =>
        result.ok ? { data: result.data, error: null, loading: false } : { data: current.data, error: result.error, loading: false },
      );
    });
    return () => {
      active = false;
    };
  }, [...deps, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, reload: () => setAttempt((n) => n + 1) };
}
