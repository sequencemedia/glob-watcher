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
  /**
   * `anymatch` returns an index for the first path to a path
   *  but the globs are supplied in "general to specific" order
   *  which means `anymatch` will never reach the later globs
   *
   *  We reverse the arrays to make them "specific to general",
   *  so when testing the indexes "less than" means after and
   *  "more than" means before in the original order
   *
   *  The result is the same: Did the user un-ignore a specific
   *  path after they ignored it with something more general?
   */
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

    // In the original glob order, "more than" would mean after,
    // but these arrays are reversed so instead we use "less than"
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

function getEventHandler (delay, queue, watcher, done) {
  function getOnRunEnd (path, n, watcher) {
    function handleError (e) {
      if (hasErrorListener(watcher)) watcher.emit('error', e)
    }

    return function onRunEnd (e) {
      if (e) handleError(e)

      if (isQueued) {
        isQueued = false
        isRunning = true

        /**
         * Run again for the same path but increment the run count
         */
        onRunStart(path, n + 1)
      }
    }
  }

  function onRunStart (path, n = 1) {
    if (isRunning) {
      if (queue) isQueued = true
    } else {
      /**
       *  Let `asyncDone` resolve this run then invoke `done`
       *
       *  If there is a queue `onRunEnd` will re-run `onRunStart`
       */
      asyncDone((...args) => done(...args, path, n), getOnRunEnd(path, n, watcher))
    }
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

  // Use sparse arrays to keep track of each glob's position in the
  // original glob array
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

  if (ignoredGlobs.some(Boolean)) {
    config.ignored = getIgnored(config.cwd, config.ignored, ignoredGlobs, watchedGlobs)
  }

  if (watchedGlobs.some(Boolean)) {
    const watched = watchedGlobs.filter(Boolean)
    const watcher = chokidar.watch(watched, config)

    if (done instanceof Function) {
      const handleEvent = getEventHandler(config.delay, config.queue, watcher, done)

      config.events
        .forEach((eventName) => {
          watcher.on(eventName, handleEvent)
        })
    }

    return watcher
  }

  throw new Error('Nothing to watch')
}
