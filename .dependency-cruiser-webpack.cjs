const path = require('node:path')

module.exports = {
    // Dependency-cruiser reads this alias in place of tsconfig compiler APIs;
    // it must stay aligned with the Vite and TypeScript "@/*" source alias.
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
}
