import '@testing-library/jest-dom';

// jsdom has no layout engine; scrollTo logs "Not implemented" without this.
window.scrollTo = () => {};
