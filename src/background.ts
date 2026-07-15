import {
  CACHE_EPOCH_SESSION_KEY,
  createMetadataDebugSnapshot,
  REQUEST_STARTS_SESSION_KEY
} from "./debug-export";
import {
  clearMetadataCache,
  metadataBundleToWire,
  type MetadataCacheStorage
} from "./metadata-cache";
import { MetadataCoordinator } from "./metadata-coordinator";
import {
  METADATA_RUNTIME_MESSAGE,
  isMetadataRuntimeRequest,
  metadataRuntimeFailure,
  metadataRuntimeSuccess,
  type MetadataRuntimeRequest
} from "./metadata-protocol";
import { MetadataService } from "./metadata-service";

const cacheStorage: MetadataCacheStorage = {
  get: (keys) => chrome.storage.local.get(keys),
  getAll: () => chrome.storage.local.get(null),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys)
};

const coordinator = new MetadataCoordinator({
  backend: {
    readEpoch: async () => {
      const values = await chrome.storage.session.get(CACHE_EPOCH_SESSION_KEY);
      const value = values[CACHE_EPOCH_SESSION_KEY];
      if (value === undefined) return undefined;
      if (typeof value !== "string") {
        throw new Error("metadata cache epoch 儲存格式無效");
      }
      return value;
    },
    writeEpoch: async (epoch) => {
      await chrome.storage.session.set({ [CACHE_EPOCH_SESSION_KEY]: epoch });
    },
    clearCache: () => clearMetadataCache(cacheStorage),
    readRequestStarts: async () => {
      const values = await chrome.storage.session.get(REQUEST_STARTS_SESSION_KEY);
      return values[REQUEST_STARTS_SESSION_KEY] ?? [];
    },
    writeRequestStarts: async (timestamps) => {
      await chrome.storage.session.set({ [REQUEST_STARTS_SESSION_KEY]: [...timestamps] });
    }
  }
});

const service = new MetadataService({ coordinator, storage: cacheStorage });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isMetadataRuntimeRequest(message)) {
    return false;
  }
  void handleRequest(message).then(
    (value) => sendResponse(metadataRuntimeSuccess(value)),
    (error) => sendResponse(metadataRuntimeFailure(error))
  );
  return true;
});

const handleRequest = async (request: MetadataRuntimeRequest): Promise<unknown> => {
  switch (request.type) {
    case METADATA_RUNTIME_MESSAGE.resolveEpisode:
      return metadataBundleToWire(await service.resolveEpisode(request.videoSn));
    case METADATA_RUNTIME_MESSAGE.clearCache:
      return { removedCount: await service.clearCache() };
    case METADATA_RUNTIME_MESSAGE.exportDebugSnapshot: {
      const [localValues, sessionValues] = await Promise.all([
        chrome.storage.local.get(null),
        chrome.storage.session.get([CACHE_EPOCH_SESSION_KEY, REQUEST_STARTS_SESSION_KEY])
      ]);
      return createMetadataDebugSnapshot({
        extensionVersion: chrome.runtime.getManifest().version,
        capturedAt: new Date(),
        localValues,
        sessionValues
      });
    }
  }
};
