'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type FilterStatus = 'all' | 'up' | 'down' | 'pending' | 'maintenance';

interface NodeSearchContextType {
  inputValue: string;
  searchTerm: string;
  setInputValue: (term: string) => void;
  clearSearch: () => void;
  isFiltering: boolean;
  searchTime: number;
  filterStatus: FilterStatus;
  setFilterStatus: (status: FilterStatus) => void;
  searchInGroup: boolean;
  setSearchInGroup: (value: boolean) => void;
}

const SEARCH_PARAM = 'search';
const STATUS_PARAM = 'status';
const SEARCH_GROUP_PARAM = 'group';
const FIXED_SEARCH_TIME = 0.1;
const DEBOUNCE_DELAY = 500;

const NodeSearchContext = createContext<NodeSearchContextType | undefined>(undefined);

export function NodeSearchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [inputValue, setInputValueState] = useState(() => searchParams.get(SEARCH_PARAM) || '');
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get(SEARCH_PARAM) || '');
  const [filterStatus, setFilterStatusLocal] = useState<FilterStatus>(
    () => (searchParams.get(STATUS_PARAM) as FilterStatus) || 'all'
  );
  const [searchInGroup, setSearchInGroupLocal] = useState(
    () => searchParams.get(SEARCH_GROUP_PARAM) === 'true'
  );

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialRef = useRef(true);

  const isFiltering = useMemo(() => {
    return Boolean(searchTerm.trim()) || filterStatus !== 'all' || searchInGroup;
  }, [searchTerm, filterStatus, searchInGroup]);

  const updateUrl = useCallback(
    (params: { search?: string; status?: FilterStatus; group?: boolean }) => {
      const urlParams = new URLSearchParams(searchParams.toString());

      if (params.search !== undefined) {
        if (params.search) {
          urlParams.set(SEARCH_PARAM, params.search);
        } else {
          urlParams.delete(SEARCH_PARAM);
        }
      }

      if (params.status !== undefined) {
        if (params.status !== 'all') {
          urlParams.set(STATUS_PARAM, params.status);
        } else {
          urlParams.delete(STATUS_PARAM);
        }
      }

      if (params.group !== undefined) {
        if (params.group) {
          urlParams.set(SEARCH_GROUP_PARAM, 'true');
        } else {
          urlParams.delete(SEARCH_GROUP_PARAM);
        }
      }

      const queryString = urlParams.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const setInputValue = useCallback(
    (value: string) => {
      setInputValueState(value);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        setSearchTerm(value);
        if (!isInitialRef.current) {
          updateUrl({ search: value });
        }
      }, DEBOUNCE_DELAY);
    },
    [updateUrl]
  );

  useEffect(() => {
    isInitialRef.current = false;
  }, []);

  const setFilterStatus = useCallback(
    (status: FilterStatus) => {
      setFilterStatusLocal(status);
      updateUrl({ status });
    },
    [updateUrl]
  );

  const setSearchInGroup = useCallback(
    (value: boolean) => {
      setSearchInGroupLocal(value);
      updateUrl({ group: value });
    },
    [updateUrl]
  );

  const clearSearch = useCallback(() => {
    setInputValueState('');
    setSearchTerm('');
    setFilterStatusLocal('all');
    setSearchInGroupLocal(false);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    updateUrl({ search: '', status: 'all', group: false });
  }, [updateUrl]);

  useEffect(() => {
    const urlSearchTerm = searchParams.get(SEARCH_PARAM) || '';
    const urlFilterStatus = (searchParams.get(STATUS_PARAM) as FilterStatus) || 'all';
    const urlSearchInGroup = searchParams.get(SEARCH_GROUP_PARAM) === 'true';

    if (urlSearchTerm !== searchTerm && urlSearchTerm !== inputValue) {
      setInputValueState(urlSearchTerm);
      setSearchTerm(urlSearchTerm);
    }

    if (urlFilterStatus !== filterStatus) {
      setFilterStatusLocal(urlFilterStatus);
    }

    if (urlSearchInGroup !== searchInGroup) {
      setSearchInGroupLocal(urlSearchInGroup);
    }
  }, [searchParams, searchTerm, inputValue, filterStatus, searchInGroup]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <NodeSearchContext.Provider
      value={{
        inputValue,
        searchTerm,
        setInputValue,
        clearSearch,
        isFiltering,
        searchTime: FIXED_SEARCH_TIME,
        filterStatus,
        setFilterStatus,
        searchInGroup,
        setSearchInGroup,
      }}
    >
      {children}
    </NodeSearchContext.Provider>
  );
}

export function useNodeSearch() {
  const context = useContext(NodeSearchContext);

  if (context === undefined) {
    throw new Error('useNodeSearch must be used within a NodeSearchProvider');
  }

  return context;
}
