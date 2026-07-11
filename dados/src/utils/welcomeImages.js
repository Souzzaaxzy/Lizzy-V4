import fs from 'fs';
import path from 'path';
import { DATABASE_DIR } from './paths.js';

const WELCOME_IMAGES_DIR = path.join(DATABASE_DIR, 'welcome_images');

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getGroupImagePath(groupId) {
    return path.join(WELCOME_IMAGES_DIR, `${groupId.replace(/[^a-zA-Z0-9@._-]/g, '_')}`);
}

function isValidImageBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
        return { valid: false, error: 'Arquivo inválido ou muito pequeno' };
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
        return { valid: false, error: `Imagem muito grande. Limite: ${MAX_FILE_SIZE_MB}MB` };
    }

    const signatures = {
        'ffd8ff': 'jpg',
        '89504e47': 'png',
        '47494638': 'gif',
        '52494646': { next: '57454250', ext: 'webp' },
        '424d': 'bmp'
    };

    const hex = buffer.toString('hex', 0, 4);

    if (signatures[hex]) {
        const sig = signatures[hex];
        if (typeof sig === 'object' && sig.next) {
            const nextHex = buffer.toString('hex', 8, 12);
            if (nextHex === sig.next) {
                return { valid: true, ext: sig.ext };
            }
        } else {
            return { valid: true, ext: sig };
        }
    }

    if (hex === '52494646') {
        const nextHex = buffer.toString('hex', 8, 12);
        if (nextHex === '57454250') {
            return { valid: true, ext: 'webp' };
        }
    }

    return { valid: false, error: 'Formato de imagem não suportado' };
}

export async function saveWelcomeImage(groupId, imageBuffer) {
    try {
        if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
            throw new Error('Buffer de imagem inválido');
        }

        const validation = isValidImageBuffer(imageBuffer);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        ensureDirectoryExists(WELCOME_IMAGES_DIR);

        const groupPath = getGroupImagePath(groupId);

        if (fs.existsSync(groupPath)) {
            fs.unlinkSync(groupPath);
        }

        const fileName = `${groupId.replace(/[^a-zA-Z0-9@._-]/g, '_')}_${Date.now()}.${validation.ext}`;
        const filePath = path.join(WELCOME_IMAGES_DIR, fileName);

        fs.writeFileSync(filePath, imageBuffer);

        const relativePath = `welcome_images/${fileName}`;

        return { success: true, path: relativePath, fullPath: filePath };
    } catch (error) {
        console.error('[WelcomeImages] Erro ao salvar imagem:', error.message);
        return { success: false, error: error.message };
    }
}

export async function loadWelcomeImage(imagePath) {
    try {
        if (!imagePath || typeof imagePath !== 'string') {
            return { success: false, error: 'Caminho da imagem inválido' };
        }

        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            return { success: false, isUrl: true, url: imagePath };
        }

        const fullPath = path.join(DATABASE_DIR, imagePath);

        if (!fs.existsSync(fullPath)) {
            return { success: false, error: 'Arquivo não encontrado' };
        }

        const buffer = fs.readFileSync(fullPath);
        return { success: true, buffer };
    } catch (error) {
        console.error('[WelcomeImages] Erro ao carregar imagem:', error.message);
        return { success: false, error: error.message };
    }
}

export async function deleteWelcomeImage(imagePath) {
    try {
        if (!imagePath || typeof imagePath !== 'string') {
            return { success: false };
        }

        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
            return { success: true };
        }

        const fullPath = path.join(DATABASE_DIR, imagePath);

        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }

        return { success: true };
    } catch (error) {
        console.error('[WelcomeImages] Erro ao deletar imagem:', error.message);
        return { success: false, error: error.message };
    }
}

export function isLocalImagePath(imagePath) {
    if (!imagePath || typeof imagePath !== 'string') {
        return false;
    }
    return !imagePath.startsWith('http://') && !imagePath.startsWith('https://');
}

export function getImagePath(groupId) {
    return path.join(WELCOME_IMAGES_DIR, `${groupId.replace(/[^a-zA-Z0-9@._-]/g, '_')}`);
}

export default {
    saveWelcomeImage,
    loadWelcomeImage,
    deleteWelcomeImage,
    isLocalImagePath,
    getImagePath
};
