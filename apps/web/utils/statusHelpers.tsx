import type { FilterStatus } from '@/components/context/NodeSearchContext';
import { AlertCircle, CheckCircle2, MinusCircle, Search, Settings } from 'lucide-react';

/**
 * Get color variant based on status
 */
export const getStatusColor = (status: FilterStatus) => {
  switch (status) {
    case 'up':
      return 'success';
    case 'down':
      return 'danger';
    case 'pending':
      return 'warning';
    case 'maintenance':
      return 'primary';
    default:
      return 'default';
  }
};

/**
 * Get icon component based on status
 */
export const getStatusIcon = (status: FilterStatus) => {
  switch (status) {
    case 'up':
      return <CheckCircle2 size={16} className="text-success" />;
    case 'down':
      return <AlertCircle size={16} className="text-danger" />;
    case 'pending':
      return <MinusCircle size={16} className="text-warning" />;
    case 'maintenance':
      return <Settings size={16} className="text-primary" />;
    default:
      return <Search size={16} />;
  }
};
