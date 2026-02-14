import { useCallback, useEffect, useRef, useState } from 'react';

export function useSearch<T>(
  items: T[],
  searchFn: (item: T, searchTerm: string) => boolean,
  delay = 300
) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<T[]>(items);

  const searchTermRef = useRef(searchTerm);

  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  const performSearch = useCallback(
    (term: string) => {
      if (!term) {
        setResults(items);
        return;
      }
      const filtered = items.filter(item => searchFn(item, term.toLowerCase()));
      setResults(filtered);
    },
    [items, searchFn]
  );

  const handleSetSearchTerm = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchTerm);
    }, delay);

    return () => clearTimeout(timer);
  }, [searchTerm, delay, performSearch]);

  useEffect(() => {
    if (searchTermRef.current) {
      performSearch(searchTermRef.current);
    }
  }, [performSearch]);

  return {
    searchTerm,
    setSearchTerm: handleSetSearchTerm,
    results,
  };
}
