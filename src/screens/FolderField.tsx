import { useTranslation } from 'react-i18next'
import { FilterChip } from '../components/FilterChip'
import { Input } from '../components/Input'
import { isAbsolute, sameFolder } from '../torrents/folders'
import './FolderField.css'

export interface FolderFieldProps {
  value: string
  onChange: (folder: string) => void
  /** The folders qBittorrent knows, offered as chips. */
  folders: string[]
  /** While the folder is sent: what's typed then would be lost when the sheet closes. */
  readOnly?: boolean
}

/** A full path for qBittorrent, typed or picked from the folders it knows: Move files' and Settings'. */
export function FolderField({ value, onChange, folders, readOnly = false }: FolderFieldProps) {
  const { t } = useTranslation()
  const target = value.trim()
  return (
    <>
      <Input
        label={t('common.folder')}
        value={value}
        mono
        // qBittorrent checks a relative path against its own working directory but saves it elsewhere,
        // and doesn't expand ~, so only a full path is sent.
        error={target && !isAbsolute(target) ? t('move.absolute') : undefined}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
      {folders.length > 0 && (
        <div role="group" aria-label={t('move.known')} className="folder-field-known">
          <span className="ks-label">{t('move.known')}</span>
          <div className="folder-field-chips">
            {folders.map((folder) => (
              <FilterChip
                key={folder}
                selected={sameFolder(folder) === sameFolder(target)}
                disabled={readOnly}
                onClick={() => onChange(folder)}
              >
                {folder}
              </FilterChip>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
