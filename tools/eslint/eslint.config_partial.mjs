import { globals } from './eslint.config_utils.mjs';

export default [
  {
    files: ['tools/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'camelcase': [
        'error',
        {
          properties: 'never',
          ignoreDestructuring: true,
          allow: ['child_process'],
        },
      ],
      'no-unused-vars': [
        'error',
        { args: 'after-used' },
      ],
      'prefer-arrow-callback': 'error',
    },
  },
  {
    // The viewer names callbacks after their functions, so the examples and
    // probes keep named function expressions.
    files: [
      'tools/evloop-viewer/examples/**/*.{js,mjs}',
      'tools/evloop-viewer/test/probes/**/*.{js,mjs}',
    ],
    rules: {
      'prefer-arrow-callback': 'off',
    },
  },
];
