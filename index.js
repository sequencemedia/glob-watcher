'use strict'

const chokidar = require('chokidar')
const debounce = require('just-debounce')
const asyncDone = require('async-done')
const defaults = require('object.defaults/immutable')
const isNegatedGlob = require('is-negated-glob')
const anymatch = require('anymatch')
const normalize = require('normalize-path')
const { join } = require('path')
const { nanoid } = require('nanoid')

const DEFAULT_OPTIONS = {
  delay: 200,
  events: ['add', 'change', 'unlink'],
  ignored: [],
  ignoreInitial: true,
  queue: true
}

const SPARSE = nanoid()

function listenerCount (eventEmitter, eventName) {
  if (typeof eventEmitter.listenerCount === 'function') {
    return eventEmitter.listenerCount(eventName)
  }

  return eventEmitter.listeners(eventName).length
}

function hasErrorListener (eventEmitter) {
  return listenerCount(eventEmitter, 'error') !== 0
}

function watch (glob, options, cb) {
  if (typeof options === 'function') {
    cb = options
    options = {}
  }

  const opts = defaults(options, DEFAULT_OPTIONS)

  if (!Array.isArray(opts.events)) {
    opts.events = [opts.events]
  }

  if (Array.isArray(glob)) {
    // We slice so we don't mutate the passed globs array
    glob = glob.slice()
  } else {
    glob = [glob]
  }

  let queued = false
  let running = false

  // These use sparse arrays to keep track of the index in the
  // original globs array
  const positives = new Array(glob.length)
  const negatives = new Array(glob.length)

  // Reverse the glob here so we don't end up with a positive
  // and negative glob in position 0 after a reverse
  glob.reverse().forEach(sortGlobs)

  function sortGlobs (globString, index) {
    const result = isNegatedGlob(globString)
    if (result.negated) {
      negatives[index] = result.pattern
    } else {
      positives[index] = result.pattern
    }
  }

  const toWatch = positives.filter(Boolean)

  function joinCwd (glob) {
    if (opts.cwd) {
      return join(normalize(opts.cwd), normalize(glob))
    }

    return normalize(glob)
  }

  function toUnsparse (array) {
    let i = 0
    const j = array.length

    for (i, j; i < j; i++) {
      array[i] = array[i] ?? SPARSE
    }

    return array
  }

  // We only do add our custom `ignored` if there are some negative globs
  // TODO: I'm not sure how to test this
  if (negatives.some(Boolean)) {
    const normalizedPositives = toUnsparse(positives.map(joinCwd))
    const normalizedNegatives = toUnsparse(negatives.map(joinCwd))

    function ignorePath (path) {
      const positiveMatch = anymatch(normalizedPositives, path, true)
      const negativeMatch = anymatch(normalizedNegatives, path, true)

      // If negativeMatch is -1, that means it was never negated
      if (negativeMatch === -1) {
        return false
      }

      if (positiveMatch === -1) {
        return true
      }

      // If the negative is "less than" the positive, that means
      // it came later in the glob array before we reversed them
      return negativeMatch < positiveMatch
    }

    opts.ignored = [].concat(opts.ignored, ignorePath)
  }

  const watcher = chokidar.watch(toWatch, opts)

  function runComplete (err) {
    running = false

    if (err && hasErrorListener(watcher)) {
      watcher.emit('error', err)
    }

    // If we have a run queued, start onChange again
    if (queued) {
      queued = false
      onChange()
    }
  }

  function onChange () {
    if (running) {
      if (opts.queue) {
        queued = true
      }
      return
    }

    running = true
    asyncDone(cb, runComplete)
  }

  let fn
  if (typeof cb === 'function') {
    fn = debounce(onChange, opts.delay)
  }

  function watchEvent (eventName) {
    watcher.on(eventName, fn)
  }

  if (fn) {
    opts.events.forEach(watchEvent)
  }

  return watcher
}

module.exports = watch
