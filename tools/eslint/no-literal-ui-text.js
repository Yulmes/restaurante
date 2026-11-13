/**
 * Regla local de ESLint (D2): prohíbe texto de interfaz escrito directamente en JSX.
 * Todo texto visible o accesible debe venir de los archivos de mensajes (i18next).
 *
 * Detecta letras (cualquier alfabeto) en:
 *  - texto entre etiquetas: <p>Hola</p>
 *  - cadenas literales como hijos: <p>{'Hola'}</p>
 *  - atributos accesibles o visibles: aria-label, title, alt, placeholder, label, …
 * Símbolos, números y puntuación (·, −, +, :1) están permitidos.
 */
const LETTER = /\p{L}/u;
const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'label',
  'placeholder',
  'title',
]);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Exige textos de interfaz desde i18n, no literales en JSX' },
    messages: {
      literal: 'Texto literal en JSX: "{{text}}". Movelo a los archivos de mensajes y usá t().',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) =>
      context.report({ node, messageId: 'literal', data: { text: text.trim().slice(0, 40) } });
    return {
      JSXText(node) {
        if (LETTER.test(node.value)) report(node, node.value);
      },
      'JSXExpressionContainer > Literal'(node) {
        if (node.parent.parent?.type === 'JSXAttribute') return;
        if (typeof node.value === 'string' && LETTER.test(node.value)) report(node, node.value);
      },
      'JSXExpressionContainer > TemplateLiteral'(node) {
        if (node.parent.parent?.type === 'JSXAttribute') return;
        const text = node.quasis.map((q) => q.value.cooked ?? '').join('');
        if (LETTER.test(text)) report(node, text);
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!TEXT_ATTRIBUTES.has(name) || !node.value) return;
        const value =
          node.value.type === 'Literal'
            ? node.value.value
            : node.value.type === 'JSXExpressionContainer' && node.value.expression.type === 'Literal'
              ? node.value.expression.value
              : null;
        if (typeof value === 'string' && LETTER.test(value)) report(node, value);
      },
    };
  },
};

export default {
  meta: { name: 'marea-baja' },
  rules: { 'no-literal-ui-text': rule },
};
