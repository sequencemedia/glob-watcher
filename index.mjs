import crypto from 'node:crypto'
import {
  join
} from 'node:path'

import chokidar from 'chokidar'
import debounce from 'just-debounce'
import asyncDone from 'async-done'
import defaults from 'object.defaults/immutable.js'
import isNegatedGlob from 'is-negated-glob'
import anymatch from 'anymatch'
import normalizePath from 'normalize-path'

const DEFAULT_OPTIONS = {
  delay: 200,
  events: ['add', 'change', 'unlink'],
  ignored: [],
  ignoreInitial: true,
  queue: true
}

const SPARSE = crypto.randomUUID()

function toUnsparse (array) {
  let i = 0
  const j = array.length

  for (i, j; i < j; i++) {
    array[i] = array[i] ?? SPARSE
  }

  return array
}

function getNormalizer (basePath) {
  return (
    basePath
      ? (glob) => join(normalizePath(basePath), normalizePath(glob))
      : (glob) => normalizePath(glob)
  )
}

function getIsPathIgnored (ignoredPaths, watchedPaths) {
  ignoredPaths.reverse()
  watchedPaths.reverse()

  return function isPathIgnored (path) {
    const ignoredIndex = anymatch(ignoredPaths, path, true)

    if (ignoredIndex === -1) { // `path` was never negated
      return false
    }

    const watchedIndex = anymatch(watchedPaths, path, true)

    if (watchedIndex === -1) {
      return true
    }

    // If `ignoredIndex` is less than `watchedIndex` then
    // the pattern appears earlier in the glob array (which
    // means later before it was reversed): so we should
    // ignore the path
    return ignoredIndex < watchedIndex
  }
}

function getIgnored (basePath, ignored = [], ignoredGlobs, watchedGlobs) {
  const normalizer = getNormalizer(basePath)
  const ignoredPaths = toUnsparse(ignoredGlobs.map(normalizer))
  const watchedPaths = toUnsparse(watchedGlobs.map(normalizer))

  return [].concat(ignored, getIsPathIgnored(ignoredPaths, watchedPaths))
}

function getListenerCount (eventEmitter, eventName) {
  if (eventEmitter.listenerCount instanceof Function) {
    return eventEmitter.listenerCount(eventName)
  }

  return eventEmitter.listeners(eventName).length
}

function hasErrorListener (eventEmitter) {
  return getListenerCount(eventEmitter, 'error') !== 0
}

function getDebounced (delay, queue, watcher, done) {
  function onRunEnd (e) {
    isRunning = false

    if (e && hasErrorListener(watcher)) {
      watcher.emit('error', e)
    }

    // If we have a run queued, start onRunStart again
    if (isQueued) {
      isQueued = false
      onRunStart()
    }
  }

  function onRunStart () {
    if (isRunning) {
      if (queue) {
        isQueued = true
      }
      return
    }

    isRunning = true
    asyncDone(done, onRunEnd)
  }

  let isQueued = false
  let isRunning = false

  return debounce(onRunStart, delay)
}

export default function watch (glob, options, done) {
  if (options instanceof Function) {
    done = options
    options = {}
  }

  const config = defaults(options, DEFAULT_OPTIONS)

  if (!Array.isArray(config.events)) {
    config.events = [config.events]
  }

  if (!Array.isArray(glob)) {
    glob = [glob]
  } else {
    glob = [...glob] // Duplicate the array so that it can be mutated
  }

  // Use sparse arrays to keep track of each glob's index in the
  // original globs array
  const ignoredGlobs = new Array(glob.length)
  const watchedGlobs = new Array(glob.length)

  glob
    .forEach((glob, i) => {
      const {
        negated,
        pattern
      } = isNegatedGlob(glob)

      if (negated) {
        ignoredGlobs[i] = pattern
      } else {
        watchedGlobs[i] = pattern
      }
    })

  // Add `ignored` to chokidar options only if there are any ...
  if (ignoredGlobs.some(Boolean)) {
    config.ignored = getIgnored(config.cwd, config.ignored, ignoredGlobs, watchedGlobs)
  }

  const watched = watchedGlobs.filter(Boolean)
  const watcher = chokidar.watch(watched, config)

  let handleEvent
  if (done instanceof Function) {
    handleEvent = getDebounced(config.delay, config.queue, watcher, done) // debounce(onRunStart, delay)
  }

  if (handleEvent) {
    config.events
      .forEach((eventName) => {
        watcher.on(eventName, handleEvent)
      })
  }

  return watcher
}
