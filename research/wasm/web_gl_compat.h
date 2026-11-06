#pragma once
#define GL_GLEXT_PROTOTYPES 1
#include <SDL.h>
#include <SDL_opengl.h>

/* WebGL2 has no desktop texture readback/level-query entry points. Track
 * actual allocations and read the attached texture through an FBO instead. */
#ifdef __cplusplus
extern "C" {
#endif
void sled_glTexImage2D(GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void *);
void sled_glDeleteTextures(GLsizei, const GLuint *);
void sled_glTexSubImage2D(GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, const void *);
void sled_glReadPixels(GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void *);
void sled_glGetTexLevelParameteriv(GLenum, GLint, GLenum, GLint *);
void sled_glGetTexImage(GLenum, GLint, GLenum, GLenum, void *);
int sled_SDL_GL_SetAttribute(SDL_GLattr attribute, int value);
void *sled_SDL_GL_GetProcAddress(const char *name);
#ifdef __cplusplus
}
#endif
#ifndef SLED_GL_IMPLEMENTATION
#define glTexImage2D sled_glTexImage2D
#define glDeleteTextures sled_glDeleteTextures
#define glTexSubImage2D sled_glTexSubImage2D
#define glReadPixels sled_glReadPixels
#define glGetTexLevelParameteriv sled_glGetTexLevelParameteriv
#define glGetTexImage sled_glGetTexImage
#define SDL_GL_SetAttribute sled_SDL_GL_SetAttribute
#define SDL_GL_GetProcAddress sled_SDL_GL_GetProcAddress
#endif
