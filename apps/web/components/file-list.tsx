'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder } from 'lucide-react';
import type { SourceFile } from '@codedna/shared';
import { buildFileTree, type FileTreeNode } from '@/lib/file-tree';
export function FileList({
  files,
  selected,
  onSelect,
  query,
  repositoryName,
}: {
  files: SourceFile[];
  selected: string | null;
  onSelect: (file: SourceFile) => void;
  query: string;
  repositoryName: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [currentFolder, setCurrentFolder] = useState('');
  const folderButtons = useRef(new Map<string, HTMLButtonElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(
    () =>
      buildFileTree(
        files.filter((file) =>
          file.path.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    [files, query],
  );
  useEffect(() => {
    if (selected) {
      const parts = selected.split('/');
      setCurrentFolder(parts.slice(0, -1).join('/'));
      setExpanded((previous) => {
        const next = new Set(previous);
        for (let i = 1; i < parts.length; i++)
          next.add(parts.slice(0, i).join('/'));
        return next;
      });
    }
  }, [selected]);
  function goToFolder(path: string) {
    setCurrentFolder(path);
    if (!path) {
      rootRef.current?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const parts = path.split('/');
    setExpanded((previous) => {
      const next = new Set(previous);
      for (let i = 1; i <= parts.length; i++)
        next.add(parts.slice(0, i).join('/'));
      return next;
    });
    folderButtons.current.get(path)?.scrollIntoView({ block: 'nearest' });
  }
  function renderFolder(folder: FileTreeNode, depth: number) {
    const open = Boolean(query) || expanded.has(folder.path);
    return (
      <div key={folder.path}>
        <button
          type="button"
          ref={(element) => {
            if (element) folderButtons.current.set(folder.path, element);
            else folderButtons.current.delete(folder.path);
          }}
          className="tree-folder"
          style={{ paddingLeft: 18 + depth * 14 }}
          aria-expanded={open}
          onClick={() => {
            setCurrentFolder(
              open
                ? folder.path.split('/').slice(0, -1).join('/')
                : folder.path,
            );
            setExpanded((previous) => {
              const next = new Set(previous);
              if (next.has(folder.path)) next.delete(folder.path);
              else next.add(folder.path);
              return next;
            });
          }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={15} />
          <span>{folder.name}</span>
        </button>
        {open && renderContents(folder, depth + 1)}
      </div>
    );
  }
  function renderContents(folder: FileTreeNode, depth: number) {
    return (
      <>
        {folder.folders.map((item) => renderFolder(item, depth))}
        {folder.files.map((file) => (
          <button
            type="button"
            key={file.id}
            className={`file-item ${selected === file.path ? 'selected' : ''}`}
            style={{ paddingLeft: 36 + depth * 14 }}
            onClick={() => onSelect(file)}
            aria-pressed={selected === file.path}
            title={file.path}
          >
            <FileCode2 size={15} />
            <span>{file.path.split('/').at(-1)}</span>
          </button>
        ))}
      </>
    );
  }
  return (
    <div className="file-list">
      {!query && (
        <nav className="file-breadcrumbs" aria-label="Current folder">
          <button
            type="button"
            onClick={() => goToFolder('')}
            aria-current={currentFolder ? undefined : 'location'}
          >
            {repositoryName}
          </button>
          {currentFolder
            .split('/')
            .filter(Boolean)
            .map((part, index, parts) => {
              const path = parts.slice(0, index + 1).join('/');
              return (
                <span key={path}>
                  <ChevronRight size={12} aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => goToFolder(path)}
                    aria-current={
                      index === parts.length - 1 ? 'location' : undefined
                    }
                  >
                    {part}
                  </button>
                </span>
              );
            })}
        </nav>
      )}
      <div className="tree-root" ref={rootRef}>
        <ChevronDown size={14} />
        <Folder size={15} />
        <span>{repositoryName}</span>
      </div>
      {tree.files.length || tree.folders.length ? (
        renderContents(tree, 0)
      ) : (
        <p className="no-files">No files match your search.</p>
      )}
    </div>
  );
}
