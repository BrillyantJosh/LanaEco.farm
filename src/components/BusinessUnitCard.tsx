import { MapPin, Tag, Edit, CircleDot, Trash2, Loader2, Users, Ban, ShoppingBag } from 'lucide-react';
import type { BusinessUnit, UnitSuspension } from '@/lib/nostr';
import { useLanguage } from '@/i18n/LanguageContext';

interface BusinessUnitCardProps {
  unit: BusinessUnit;
  onEdit: (unit: BusinessUnit) => void;
  onDelete: (unit: BusinessUnit) => void;
  onStaff: (unit: BusinessUnit) => void;
  onListings?: (unit: BusinessUnit) => void;
  isDeleting?: boolean;
  suspension?: UnitSuspension | null;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-400',
  paused: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-400',
  archived: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
};

export function BusinessUnitCard({ unit, onEdit, onDelete, onStaff, onListings, isDeleting, suspension }: BusinessUnitCardProps) {
  const { t } = useLanguage();

  return (
    <div className={`rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition ${
      suspension ? 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
    }`}>
      {/* Image */}
      {unit.images[0] && (
        <div className="h-40 overflow-hidden">
          <img
            src={unit.images[0]}
            alt={unit.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-white leading-tight">{unit.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[unit.status] || statusColors.active}`}>
            {unit.status}
          </span>
        </div>

        {/* Category */}
        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <Tag className="w-3.5 h-3.5" />
          <span>{unit.category}</span>
          {unit.categoryDetail && <span className="text-gray-400 dark:text-gray-500">/ {unit.categoryDetail}</span>}
        </div>

        {/* Location */}
        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <MapPin className="w-3.5 h-3.5" />
          <span>{unit.receiverCity}, {unit.receiverCountry}</span>
        </div>

        {/* Currency */}
        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <CircleDot className="w-3.5 h-3.5" />
          <span>{unit.currency}</span>
        </div>

        {/* Suspension Banner */}
        {suspension && (
          <div className="bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Ban className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="text-sm font-bold text-red-700 dark:text-red-400">SUSPENDED</span>
            </div>
            <p className="text-sm text-red-700 dark:text-red-400">{suspension.reason}</p>
            {suspension.content && suspension.content !== suspension.reason && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{suspension.content}</p>
            )}
            {suspension.activeUntil && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                Until: {new Date(parseInt(suspension.activeUntil) * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onEdit(unit)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
          >
            <Edit className="w-4 h-4" />
            Edit
          </button>
          {onListings && (
            <button
              onClick={() => onListings(unit)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition text-sm font-medium"
              title={t('common.listings')}
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="text-xs">{t('common.listings')}</span>
            </button>
          )}
          <button
            onClick={() => onStaff(unit)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition text-sm font-medium"
            title="Osebje"
          >
            <Users className="w-4 h-4" />
            <span className="text-xs">{t('common.staff')}</span>
          </button>
          <button
            onClick={() => onDelete(unit)}
            disabled={isDeleting}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition text-sm font-medium disabled:opacity-50"
            title={t('common.delete')}
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
