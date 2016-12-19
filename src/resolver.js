'use strict'

const async = require('async')
const TrieNode = require('merkle-patricia-tree/trieNode')
const util = require('./util')
const cidForHash = require('./common').cidForHash
const isExternalLink = require('./common').isExternalLink

exports = module.exports

exports.multicodec = 'eth-trie'

/*
 * resolve: receives a path and a block and returns the value on path,
 * throw if not possible. `block` is an IPFS Block instance (contains data + key)
 */
exports.resolve = (block, path, callback) => {
  util.deserialize(block.data, (err, trieNode) => {
    if (err) return callback(err)

    // root
    if (!path || path === '/') {
      let result = { value: node, remainderPath: '' }
      return callback(null, result)
    }

    // parse path for parts
    let pathParts = path.split('/')
    let triePathLength = guessPathEndFromParts(pathParts) + 1
    let trieRemainderPath = pathParts.slice(0, triePathLength).join('/')
    let remainderPath = pathParts.slice(triePathLength).join('/')
    let currentNode = trieNode

    // dig down the trie until we can dig no further
    async.doWhilst(digDeeper, checkIfWeCanGoDeeper, (err) => {
      if (err) return callback(err)
      // finalize value
      let value
      if (currentNode.type === 'leaf') {
        // leaf nodes resolve to their actual value
        value = currentNode.getValue()
      } else {
        value = currentNode
      }
      // finalize path remainder
      if (trieRemainderPath) {
        remainderPath = trieRemainderPath + remainderPath
      }
      callback(null, {
        value: value,
        remainderPath: remainderPath,
      })
    })

    // dig down to next node
    function digDeeper (next) {
      resolveOnNode(currentNode, trieRemainderPath, (err, result) => {
        if (err) return next(err)
        currentNode = result.value
        trieRemainderPath = result.remainderPath
        next()
      })
    }

    // check if we can go deeper (result is inline node and path remains)
    function checkIfWeCanGoDeeper () {
      return trieRemainderPath.length > 0 && !isExternalLink(currentNode)
    }
  })
}

/*
 * tree: returns a flattened array with paths: values of the project. options
 * are option (i.e. nestness)
 */

exports.tree = (block, options, callback) => {
  // parse arguments
  if (typeof options === 'function') {
    callback = options
    options = undefined
  }
  if (!options) {
    options = {}
  }

  util.deserialize(block.data, (err, trieNode) => {
    if (err) return callback(err)
    pathsFromTrieNode(trieNode, callback)
  })
}

// util

function resolveOnNode(trieNode, path, callback){
  pathsFromTrieNode(trieNode, (err, children) => {
    if (err) return callback(err)

    // find child by matching path of any length
    let treeResult = children.find(child => path.slice(0, child.path.length) === child.path)

    if (!treeResult) {
      let err = new Error('Path not found ("' + path + '").')
      return callback(err)
    }

    let value = treeResult.value
    let remainderPath
    if (treeResult.value.type === 'leaf') {
      // leaf nodes consume whole path
      remainderPath = ''
    } else {
      // non-leaf nodes leave remainder path
      remainderPath = path.slice(treeResult.path.length + 1)
    }

    let result = {
      value: value,
      remainderPath: remainderPath
    }
    return callback(null, result)
  })
}

function pathsFromTrieNode(trieNode, callback){
  const paths = []

  trieNode.getChildren().forEach((childData) => {
    let key = nibbleToPath(childData[0])
    let value = childData[1]
    if (TrieNode.isRawNode(value)) {
      // some nodes contain their children as data
      paths.push({
        path: key,
        value: new TrieNode(value),
      })
    } else {
      // other nodes link by hash
      let link = { '/': cidForHash('eth-trie', value).toBaseEncodedString() }
      paths.push({
        path: key,
        value: link,
      })
    }
  })

  callback(null, paths)
}

function nibbleToPath(data){
  return data.map((num) => num.toString(16)).join('/')
}

// we dont know how far we've come
// we dont know how far we have left
// the only thing we can do
// is make an educated guess
function guessPathEndFromParts(pathParts){
  // find a path part that is not a valid half-byte
  let matchingPart = pathParts.find((part) => part.length > 1 || Number.isNaN(parseInt(part, 16)))
  if (!matchingPart) return pathParts.length - 1
  // use (index - 1) of matching part
  return pathParts.indexOf(matchingPart)-1
}