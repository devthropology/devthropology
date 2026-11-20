import type { FileSystemNode } from "../../../shared/models/fileSystemTree";

export function getChildrenOf(nodes: FileSystemNode[], parentPath: string | null) {
  return nodes.filter((node) => node.parent_path === parentPath);
}

export function sortFileSystemNodes(nodes: FileSystemNode[]) {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

export function getSortedChildrenOf(nodes: FileSystemNode[], parentPath: string | null) {
  return sortFileSystemNodes(getChildrenOf(nodes, parentPath));
}

export function getAncestorPaths(path: string) {
  const parts = path.split("/").filter(Boolean);
  const ancestors: string[] = [];

  for (let index = 0; index < parts.length - 1; index += 1) {
    ancestors.push(parts.slice(0, index + 1).join("/"));
  }

  return ancestors;
}

interface CompactFolderChainOptions {
  startNode: FileSystemNode;
  allNodes: FileSystemNode[];
  levelsLoaded: ReadonlySet<string>;
  expandedFolders: ReadonlySet<string>;
}

export function getCompactFolderChain({
  startNode,
  allNodes,
  levelsLoaded,
  expandedFolders,
}: CompactFolderChainOptions) {
  const compactChain = [startNode];

  if (startNode.type !== "folder") {
    return compactChain;
  }

  let currentNode = startNode;

  while (levelsLoaded.has(currentNode.path) && expandedFolders.has(currentNode.path)) {
    const children = getSortedChildrenOf(allNodes, currentNode.path);

    if (children.length !== 1 || children[0]?.type !== "folder") {
      break;
    }

    currentNode = children[0];
    compactChain.push(currentNode);
  }

  return compactChain;
}

export function collapseExpandedFolderPaths(
  expandedFolders: ReadonlySet<string>,
  collapseRoot: string,
) {
  const nextExpandedFolders = new Set(expandedFolders);

  Array.from(nextExpandedFolders).forEach((expandedPath) => {
    if (expandedPath === collapseRoot || expandedPath.startsWith(`${collapseRoot}/`)) {
      nextExpandedFolders.delete(expandedPath);
    }
  });

  return nextExpandedFolders;
}

export async function collectAutoExpandFolderPaths(
  startNode: FileSystemNode,
  loadChildren: (node: FileSystemNode) => Promise<FileSystemNode[]>,
) {
  const pathsToExpand = [startNode.path];

  if (startNode.type !== "folder") {
    return pathsToExpand;
  }

  let currentNode = startNode;

  while (currentNode.type === "folder") {
    const children = sortFileSystemNodes(await loadChildren(currentNode)).filter(
      (child) => child.parent_path === currentNode.path,
    );

    if (children.length !== 1 || children[0]?.type !== "folder") {
      break;
    }

    currentNode = children[0];
    pathsToExpand.push(currentNode.path);
  }

  return pathsToExpand;
}
