cmake_minimum_required(VERSION 3.20)
project(SledStormBrowserExperiment LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Configure with the project-local Emscripten toolchain")
endif()

set(PSX_RECOMP_UI OFF CACHE BOOL "" FORCE)
set(PSX_REWIND OFF CACHE BOOL "" FORCE)
set(PSX_DEBUG_TOOLS OFF CACHE BOOL "" FORCE)
set(PSX_NETPLAY OFF CACHE BOOL "" FORCE)
set(PSX_ENABLE_VULKAN OFF CACHE BOOL "" FORCE)
set(PSX_SDL_BACKEND SDL2 CACHE STRING "" FORCE)
set(SDL2_INCLUDE_DIRS "${EMSCRIPTEN_SYSROOT}/include/SDL2" CACHE STRING "" FORCE)
set(SDL2_LIBRARIES "-sUSE_SDL=2" CACHE STRING "" FORCE)
set(ZLIB_INCLUDE_DIR "${EMSCRIPTEN_SYSROOT}/include" CACHE PATH "" FORCE)
set(ZLIB_LIBRARY "${EMSCRIPTEN_SYSROOT}/lib/wasm32-emscripten/libz.a" CACHE FILEPATH "" FORCE)
set(CMAKE_DISABLE_FIND_PACKAGE_OpenGL ON)
add_compile_options(-sUSE_SDL=2 -sUSE_ZLIB=1)
add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:-fexceptions>")
add_compile_definitions(PSX_WEB=1)
add_compile_definitions(SDL_LockSpinlock=SDL_AtomicLock SDL_UnlockSpinlock=SDL_AtomicUnlock)
add_subdirectory(../port port)
get_target_property(_sources psx-runtime SOURCES)
list(FILTER _sources EXCLUDE REGEX "/psx_fiber\\.c$")
list(FILTER _sources EXCLUDE REGEX "/main\\.cpp$")
list(FILTER _sources EXCLUDE REGEX "/render_pass\\.c$")
list(FILTER _sources EXCLUDE REGEX "/gpu\\.c$")
list(FILTER _sources EXCLUDE REGEX "SLES_021[.]94_full_30[.]c$")
list(FILTER _sources EXCLUDE REGEX "/sio[.]c$")
list(FILTER _sources EXCLUDE REGEX "SLES_021[.]94_full_28[.]c$")
set_property(TARGET psx-runtime PROPERTY SOURCES "${_sources}")
target_sources(psx-runtime PRIVATE fiber_web.c web_gl_compat.c browser_probe.c web_network.c web_camera.c web_hud.c web_progress.c web_preferences.c web_controllers.c
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.cache/browser-source/main_web.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.cache/browser-source/render_pass_web.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.cache/browser-source/gpu_web.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.cache/browser-source/game_hud_web.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.cache/browser-source/game_assets_web.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.cache/browser-source/sio_web.c")
target_include_directories(psx-runtime PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/../port/psxrecomp/runtime/src"
    "${CMAKE_CURRENT_SOURCE_DIR}/../port/generated")
set_source_files_properties(
    "${CMAKE_CURRENT_SOURCE_DIR}/../port/psxrecomp/runtime/src/gpu_gl_renderer.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.cache/browser-source/main_web.cpp"
    DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../port"
    PROPERTIES COMPILE_OPTIONS "-include;${CMAKE_CURRENT_SOURCE_DIR}/web_gl_compat.h")
set_source_files_properties(
    "${CMAKE_CURRENT_SOURCE_DIR}/../port/psxrecomp/runtime/src/host_span_ring.c"
    DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../port"
    PROPERTIES COMPILE_DEFINITIONS "getrusage=sled_web_getrusage")
set_target_properties(psx-runtime PROPERTIES SUFFIX ".js")
target_link_options(psx-runtime PRIVATE
    -sUSE_SDL=2 -sUSE_ZLIB=1 -sALLOW_MEMORY_GROWTH=1
    -sSTACK_SIZE=8388608 -sASYNCIFY=1 -sFORCE_FILESYSTEM=1
    -sINVOKE_RUN=0 "-sEXPORTED_RUNTIME_METHODS=FS,callMain,Asyncify,HEAPU8"
    --js-library "${CMAKE_CURRENT_SOURCE_DIR}/disc_io.js"
    -sASYNCIFY_STACK_SIZE=65536
    "-sINCOMING_MODULE_JS_API=wasmBinary,canvas,noInitialRun,locateFile,print,printErr,onAbort,onRuntimeInitialized"
    -sENVIRONMENT=web -sASSERTIONS=1
    -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sFULL_ES3=1 -fexceptions -O3)
