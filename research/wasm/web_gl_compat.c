#define SLED_GL_IMPLEMENTATION
#include "web_gl_compat.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <emscripten/html5_webgl.h>

static void unsupported(const char *message);
static int dual_blend_available = -1;
static int enable_dual_blend(void) {
    if (dual_blend_available < 0) {
        dual_blend_available = emscripten_webgl_enable_extension(
            emscripten_webgl_get_current_context(), "WEBGL_blend_func_extended");
        fprintf(stderr, "Sled Storm WebGL2: dual-source blending extension %s\n",
                dual_blend_available ? "enabled" : "unavailable");
    }
    return dual_blend_available;
}

/* WebGL exposes no BindFragDataLocationIndexed function. The texture shader
 * below receives the exact same fixed bindings via ESSL layout qualifiers.
 * Refuse any binding outside that audited mapping. */
static void sled_bind_frag_location(GLuint program, GLuint color, GLuint index, const GLchar *name) {
    (void)program;
    if (color != 0 || !((index == 0 && strcmp(name, "frag") == 0) ||
                       (index == 1 && strcmp(name, "blend_factor") == 0)))
        unsupported("unmapped fragment output binding");
}

int sled_SDL_GL_SetAttribute(SDL_GLattr attribute, int value) {
    if (attribute == SDL_GL_CONTEXT_PROFILE_MASK) value = SDL_GL_CONTEXT_PROFILE_ES;
    if (attribute == SDL_GL_CONTEXT_MAJOR_VERSION) value = 3;
    if (attribute == SDL_GL_CONTEXT_MINOR_VERSION) value = 0;
    return SDL_GL_SetAttribute(attribute, value);
}

static void sled_shader_source(GLuint shader, GLsizei count, const GLchar *const *strings,
                               const GLint *lengths) {
    size_t size = 0;
    for (GLsizei i = 0; i < count; ++i)
        size += lengths && lengths[i] >= 0 ? (size_t)lengths[i] : strlen(strings[i]);
    char *joined = malloc(size + 1);
    if (!joined) abort();
    size_t offset = 0;
    for (GLsizei i = 0; i < count; ++i) {
        size_t n = lengths && lengths[i] >= 0 ? (size_t)lengths[i] : strlen(strings[i]);
        memcpy(joined + offset, strings[i], n); offset += n;
    }
    joined[size] = 0;
    if (strncmp(joined, "#version 330\n", 13) == 0) {
        if (strstr(joined, "noperspective") && !emscripten_webgl_enable_extension(
                emscripten_webgl_get_current_context(), "NV_shader_noperspective_interpolation"))
            unsupported("shader requires NV_shader_noperspective_interpolation");
        static const char prefix[] = "#version 300 es\n#extension GL_NV_shader_noperspective_interpolation : enable\nprecision highp float;\nprecision highp int;\n"
            "precision highp usampler2D;\nprecision highp isampler2D;\n";
        const char *dual_outputs = "out vec4 frag; out vec4 blend_factor;";
        char *outputs = strstr(joined + 13, dual_outputs);
        if (outputs) {
            if (!enable_dual_blend()) unsupported("texture shader requires WEBGL_blend_func_extended");
            *outputs = 0;
            static const char dual_prefix[] = "#version 300 es\n#extension GL_EXT_blend_func_extended : require\n"
                "#extension GL_NV_shader_noperspective_interpolation : require\n"
                "precision highp float;\nprecision highp int;\nprecision highp usampler2D;\nprecision highp isampler2D;\n";
            const GLchar *parts[] = {dual_prefix, joined + 13,
                "layout(location=0,index=0) out vec4 frag; layout(location=0,index=1) out vec4 blend_factor;",
                outputs + strlen(dual_outputs)};
            glShaderSource(shader, 4, parts, NULL);
        } else {
            const GLchar *parts[] = {prefix, joined + 13};
            glShaderSource(shader, 2, parts, NULL);
        }
    } else {
        const GLchar *parts[] = {joined};
        glShaderSource(shader, 1, parts, NULL);
    }
    free(joined);
}

void *sled_SDL_GL_GetProcAddress(const char *name) {
    if (strcmp(name, "glShaderSource") == 0) return (void *)sled_shader_source;
    if (strcmp(name, "glBindFragDataLocationIndexed") == 0)
        return enable_dual_blend() ? (void *)sled_bind_frag_location : NULL;
    return SDL_GL_GetProcAddress(name);
}

typedef struct TextureSize { GLuint id; GLint w, h; struct TextureSize *next; } TextureSize;
static TextureSize *sizes;
static void unsupported(const char *message) {
    fprintf(stderr, "Sled Storm WebGL adapter: %s\n", message);
    abort();
}
static TextureSize *bound_texture(GLenum target, GLint level) {
    if (target != GL_TEXTURE_2D || level != 0) unsupported("only level-zero 2D textures are supported");
    GLint id;
    glGetIntegerv(GL_TEXTURE_BINDING_2D, &id);
    for (TextureSize *s = sizes; s; s = s->next) if (s->id == (GLuint)id) return s;
    return NULL;
}
/* Native capture/present buffers are BGRA byte arrays. WebGL2 accepts RGBA,
 * so convert channels while preserving pixel-store stride and skip state. */
typedef struct PixelStore { GLint row, pixels, rows, alignment; } PixelStore;
static PixelStore pixel_store(int unpack) {
    PixelStore state;
    GLint buffer;
    glGetIntegerv(unpack ? GL_PIXEL_UNPACK_BUFFER_BINDING : GL_PIXEL_PACK_BUFFER_BINDING, &buffer);
    if (buffer) unsupported("BGRA conversion through a pixel buffer object is not implemented");
    glGetIntegerv(unpack ? GL_UNPACK_ROW_LENGTH : GL_PACK_ROW_LENGTH, &state.row);
    glGetIntegerv(unpack ? GL_UNPACK_SKIP_PIXELS : GL_PACK_SKIP_PIXELS, &state.pixels);
    glGetIntegerv(unpack ? GL_UNPACK_SKIP_ROWS : GL_PACK_SKIP_ROWS, &state.rows);
    glGetIntegerv(unpack ? GL_UNPACK_ALIGNMENT : GL_PACK_ALIGNMENT, &state.alignment);
    return state;
}
static void set_pixel_store(int unpack, PixelStore state) {
    glPixelStorei(unpack ? GL_UNPACK_ROW_LENGTH : GL_PACK_ROW_LENGTH, state.row);
    glPixelStorei(unpack ? GL_UNPACK_SKIP_PIXELS : GL_PACK_SKIP_PIXELS, state.pixels);
    glPixelStorei(unpack ? GL_UNPACK_SKIP_ROWS : GL_PACK_SKIP_ROWS, state.rows);
    glPixelStorei(unpack ? GL_UNPACK_ALIGNMENT : GL_PACK_ALIGNMENT, state.alignment);
}
static unsigned char *pixel_buffer(GLsizei w, GLsizei h) {
    if (w <= 0 || h <= 0 || (size_t)w > SIZE_MAX / (size_t)h / 4)
        unsupported("invalid BGRA conversion dimensions");
    unsigned char *pixels = malloc((size_t)w * h * 4);
    if (!pixels) abort();
    return pixels;
}
static void swap_rows(unsigned char *out, const unsigned char *in, GLsizei w, GLsizei h,
                       PixelStore state, int compact_output) {
    size_t row = (size_t)(state.row ? state.row : w) * 4;
    row = (row + state.alignment - 1) / state.alignment * state.alignment;
    size_t skip = (size_t)state.rows * row + (size_t)state.pixels * 4;
    for (GLsizei y = 0; y < h; ++y) for (GLsizei x = 0; x < w; ++x) {
        size_t compact = ((size_t)y * w + x) * 4, strided = skip + y * row + x * 4;
        size_t o = compact_output ? compact : strided, i = compact_output ? strided : compact;
        out[o] = in[i + 2]; out[o + 1] = in[i + 1]; out[o + 2] = in[i]; out[o + 3] = in[i + 3];
    }
}
void sled_glTexImage2D(GLenum target, GLint level, GLint internal, GLsizei w, GLsizei h,
                       GLint border, GLenum format, GLenum type, const void *pixels) {
    if (format == GL_BGRA && type == GL_UNSIGNED_BYTE && pixels) {
        PixelStore state = pixel_store(1);
        unsigned char *rgba = pixel_buffer(w, h);
        swap_rows(rgba, pixels, w, h, state, 1);
        set_pixel_store(1, (PixelStore){0, 0, 0, 1});
        glTexImage2D(target, level, internal, w, h, border, GL_RGBA, type, rgba);
        set_pixel_store(1, state); free(rgba);
    } else glTexImage2D(target, level, internal, w, h, border,
                         format == GL_BGRA ? GL_RGBA : format, type, pixels);
    if (target != GL_TEXTURE_2D || level != 0) return;
    TextureSize *size = bound_texture(target, level);
    if (!size) {
        GLint id;
        glGetIntegerv(GL_TEXTURE_BINDING_2D, &id);
        size = calloc(1, sizeof(*size));
        if (!size) abort();
        size->id = id; size->next = sizes; sizes = size;
    }
    size->w = w; size->h = h;
}
void sled_glTexSubImage2D(GLenum target, GLint level, GLint x, GLint y, GLsizei w, GLsizei h,
                         GLenum format, GLenum type, const void *pixels) {
    if (format != GL_BGRA || type != GL_UNSIGNED_BYTE) {
        glTexSubImage2D(target, level, x, y, w, h, format, type, pixels); return;
    }
    PixelStore state = pixel_store(1);
    unsigned char *rgba = pixel_buffer(w, h);
    swap_rows(rgba, pixels, w, h, state, 1);
    set_pixel_store(1, (PixelStore){0, 0, 0, 1});
    glTexSubImage2D(target, level, x, y, w, h, GL_RGBA, type, rgba);
    set_pixel_store(1, state); free(rgba);
}
void sled_glReadPixels(GLint x, GLint y, GLsizei w, GLsizei h, GLenum format, GLenum type, void *pixels) {
    if (format != GL_BGRA || type != GL_UNSIGNED_BYTE) {
        glReadPixels(x, y, w, h, format, type, pixels); return;
    }
    PixelStore state = pixel_store(0);
    unsigned char *rgba = pixel_buffer(w, h);
    set_pixel_store(0, (PixelStore){0, 0, 0, 1});
    glReadPixels(x, y, w, h, GL_RGBA, type, rgba);
    set_pixel_store(0, state);
    swap_rows(pixels, rgba, w, h, state, 0);
    free(rgba);
}
void sled_glDeleteTextures(GLsizei count, const GLuint *ids) {
    glDeleteTextures(count, ids);
    for (GLsizei i = 0; i < count; ++i) {
        TextureSize **cursor = &sizes;
        while (*cursor) {
            if ((*cursor)->id == ids[i]) {
                TextureSize *old = *cursor; *cursor = old->next; free(old); break;
            }
            cursor = &(*cursor)->next;
        }
    }
}
void sled_glGetTexLevelParameteriv(GLenum target, GLint level, GLenum pname, GLint *out) {
    TextureSize *size = bound_texture(target, level);
    if (!size) unsupported("query of untracked texture");
    if (pname == GL_TEXTURE_WIDTH) *out = size->w;
    else if (pname == GL_TEXTURE_HEIGHT) *out = size->h;
    else unsupported("unsupported texture-level parameter");
}
void sled_glGetTexImage(GLenum target, GLint level, GLenum format, GLenum type, void *out) {
    TextureSize *size = bound_texture(target, level);
    if (!size || size->w <= 0 || size->h <= 0 || type != GL_UNSIGNED_BYTE ||
        (format != GL_RGB && format != GL_RGBA)) unsupported("unsupported texture readback");
    GLint previous, alignment;
    GLuint fbo;
    glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &previous);
    glGetIntegerv(GL_PACK_ALIGNMENT, &alignment);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, target, size->id, level);
    if (glCheckFramebufferStatus(GL_READ_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
        unsupported("texture cannot be attached for readback");
    if ((size_t)size->w > SIZE_MAX / (size_t)size->h / 4)
        unsupported("texture readback is too large");
    size_t pixels = (size_t)size->w * size->h;
    unsigned char *rgba = malloc(pixels * 4);
    if (!rgba) abort();
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, size->w, size->h, GL_RGBA, type, rgba);
    const size_t channels = format == GL_RGB ? 3 : 4;
    const size_t stride = ((size_t)size->w * channels + alignment - 1) / alignment * alignment;
    unsigned char *destination = out;
    for (GLint y = 0; y < size->h; ++y)
        for (GLint x = 0; x < size->w; ++x)
            for (size_t c = 0; c < channels; ++c)
                destination[y * stride + x * channels + c] = rgba[((size_t)y * size->w + x) * 4 + c];
    free(rgba);
    glPixelStorei(GL_PACK_ALIGNMENT, alignment);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, previous);
    glDeleteFramebuffers(1, &fbo);
}
