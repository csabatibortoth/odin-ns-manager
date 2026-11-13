'use strict';

const js         = require('@eslint/js');
const stylistic  = require('@stylistic/eslint-plugin');
const globals    = require('globals');

module.exports = [
    {
        ignores: ['coverage/**']
    },
    js.configs.recommended,
    {
        plugins: {
            '@stylistic': stylistic
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType:  'commonjs',
            globals:     globals.node
        },
        rules: {
            'no-console':           'off',
            'no-case-declarations': 'off',
            'no-unused-vars':       ['error', {args: 'none'}],
            'curly':                'error',
            'no-caller':            'error',
            'eqeqeq':               'error',
            'no-var':               'error',
            'no-bitwise':           'error',
            'camelcase':            ['error', {properties: 'never'}],
            'no-proto':             'error',
            'no-new-wrappers':      'error',
            'yoda':                 ['error', 'never', {exceptRange: true}],
            'no-with':              'error',
            'no-multi-str':         'error',
            'one-var':              ['error', 'never'],
            'dot-notation':         'error',

            '@stylistic/indent': ['error', 4, {
                SwitchCase:       1,
                ObjectExpression: 1,
                CallExpression:   {arguments: 1}
            }],
            '@stylistic/linebreak-style':             ['error', 'unix'],
            '@stylistic/quotes':                      ['error', 'single', {avoidEscape: true}],
            '@stylistic/semi':                        ['error', 'always'],
            '@stylistic/arrow-spacing':               'error',
            '@stylistic/no-trailing-spaces':          'error',
            '@stylistic/space-before-function-paren': ['error', {
                anonymous:  'always',
                named:      'never',
                asyncArrow: 'always'
            }],
            '@stylistic/function-call-spacing': ['error', 'never'],
            '@stylistic/array-bracket-spacing': 'error',
            '@stylistic/space-in-parens':       'error',
            '@stylistic/quote-props':           ['error', 'as-needed', {keywords: false, unnecessary: false}],
            '@stylistic/space-unary-ops':       'error',
            '@stylistic/space-infix-ops':       'error',
            '@stylistic/comma-spacing':         'error',
            '@stylistic/brace-style':           ['error', '1tbs'],
            '@stylistic/no-multi-spaces':       ['error', {
                exceptions: {
                    VariableDeclarator:   true,
                    AssignmentExpression: true,
                    Property:             true
                }
            }],
            '@stylistic/semi-spacing':        'error',
            '@stylistic/space-before-blocks': 'error',
            '@stylistic/wrap-iife':           'error',
            '@stylistic/comma-style':         'error',
            '@stylistic/eol-last':            'error',
            '@stylistic/max-len':             ['error', 120],
            '@stylistic/spaced-comment':      'error'
        }
    },
    {
        // DNS wire format and DNSSEC hashes are bit level work
        files: ['src/dnssec/**', 'tests/Unit/dnssec/**', 'tests/dnssecWorld.js'],
        rules: {
            'no-bitwise': 'off'
        }
    },
    {
        files:           ['tests/**'],
        languageOptions: {
            globals: globals.mocha
        }
    }
];
