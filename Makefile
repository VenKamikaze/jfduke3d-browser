# Duke3D Makefile for GNU Make

# Create Makefile.user yourself to provide your own overrides
# for configurable values
-include Makefile.user

##
##
## CONFIGURABLE OPTIONS
##
##

# Engine options
#  USE_POLYMOST   - enables Polymost renderer
#  USE_OPENGL     - enables OpenGL support in Polymost
#     Define as 0 to disable OpenGL
#     Define as USE_GL2 (or 1 or 2) for GL 2.0/2.1 profile
#     Define as USE_GL3 (or 3) for GL 3.2 Core profile
#     Define as USE_GLES2 (or 12) for GLES 2.0 profile
#  USE_ASM        - enables the use of assembly code if supported
#
USE_POLYMOST ?= 1
USE_OPENGL ?= 1
USE_ASM ?= 1

# Debugging options
#  RELEASE - 1 = optimised release build, no debugging aids
RELEASE ?= 1

# Path where game data is installed
DATADIR ?= /usr/local/share/games/jfduke3d

##
##
## HERE BE DRAGONS
##
##

ENGINEROOT=jfbuild
ENGINEINC=$(ENGINEROOT)/include
MACTROOT=jfmact
AUDIOLIBROOT=jfaudiolib
SRC=src
RSRC=rsrc

CC?=gcc
CXX?=g++
RC?=windres

OURCFLAGS=-g -W -Wall -fno-strict-aliasing -std=c99
OURCXXFLAGS=-g -W -Wall -fno-exceptions -fno-rtti -std=c++98
OURCPPFLAGS=-I$(SRC) -I$(ENGINEINC) -I$(MACTROOT) -I$(AUDIOLIBROOT)/include
OURLDFLAGS=

ifneq ($(RELEASE),0)
	# Default optimisation settings
	CFLAGS?=-fomit-frame-pointer -O1
	CXXFLAGS?=-fomit-frame-pointer -O1
else
	CFLAGS?=-Og
	CXXFLAGS?=-Og
endif

# Filename extensions, used in Makefile.deps etc
o=o
res=o

include $(ENGINEROOT)/Makefile.shared

# Apply shared flags
OURCFLAGS+= $(BUILDCFLAGS)
OURCXXFLAGS+= $(BUILDCXXFLAGS)
OURCPPFLAGS+= $(BUILDCPPFLAGS)
OURLDFLAGS+= $(BUILDLDFLAGS)

include $(AUDIOLIBROOT)/Makefile.shared

OURLDFLAGS+= $(JFAUDIOLIB_LDFLAGS)

GAMEOBJS=$(SRC)/game.$o \
	$(SRC)/actors.$o \
	$(SRC)/gamedef.$o \
	$(SRC)/global.$o \
	$(SRC)/menues.$o \
	$(SRC)/player.$o \
	$(SRC)/premap.$o \
	$(SRC)/sector.$o \
	$(SRC)/rts.$o \
	$(SRC)/config.$o \
	$(SRC)/osdfuncs.$o \
	$(SRC)/osdcmds.$o \
	$(SRC)/grpscan.$o \
	$(SRC)/sounds.$o

GAMEOBJS+= \
	$(MACTROOT)/util_lib.$o \
	$(MACTROOT)/file_lib.$o \
	$(MACTROOT)/control.$o \
	$(MACTROOT)/keyboard.$o \
	$(MACTROOT)/mouse.$o \
	$(MACTROOT)/mathutil.$o \
	$(MACTROOT)/scriplib.$o \
	$(MACTROOT)/animlib.$o

EDITOROBJS=$(SRC)/astub.$o

# Specialise for the platform
ifeq ($(PLATFORM),LINUX)
	OURLDFLAGS+= $(JFAUDIOLIB_LDFLAGS)
	OURCPPFLAGS+= -DDATADIR=\"$(DATADIR)\"
endif
ifeq ($(PLATFORM),BSD)
	OURLDFLAGS+= $(JFAUDIOLIB_LDFLAGS) -pthread
	OURCPPFLAGS+= -DDATADIR=\"$(DATADIR)\"
endif
ifeq ($(PLATFORM),WINDOWS)
	GAMEOBJS+= $(SRC)/gameres.$(res) \
		$(SRC)/startwin_game.$o
	EDITOROBJS+= $(SRC)/buildres.$(res)
endif
ifeq ($(PLATFORM),DARWIN)
	OURLDFLAGS+= -framework Foundation
endif
ifeq ($(PLATFORM),EMSCRIPTEN)
	# Browser: the page puts the GRP in /data (a folder that is not persisted).
	OURCPPFLAGS+= -DDATADIR=\"/data\"
	# Compile at -O2 as the link does (the native default is -O1).
	CFLAGS:=$(patsubst -O1,-O2,$(CFLAGS))
	CXXFLAGS:=$(patsubst -O1,-O2,$(CXXFLAGS))
endif

ifeq ($(RENDERTYPE),SDL)
	OURCFLAGS+= $(SDLCONFIG_CFLAGS)
	OURLDFLAGS+= $(SDLCONFIG_LIBS)

	ifeq (1,$(HAVE_GTK))
		OURCFLAGS+= $(GTKCONFIG_CFLAGS)
		OURLDFLAGS+= $(GTKCONFIG_LIBS)

		GAMEOBJS+= $(SRC)/startgtk_game.$o \
			$(RSRC)/startgtk_game_gresource.$o
		EDITOROBJS+= $(RSRC)/startgtk_build_gresource.$o
	endif

	GAMEOBJS+= $(RSRC)/game_bmp.$o
	EDITOROBJS+= $(RSRC)/build_bmp.$o
endif

# Source-control version stamping
ifneq (,$(findstring git version,$(shell git --version)))
GAMEOBJS+= $(SRC)/version-auto.$o
EDITOROBJS+= $(SRC)/version-auto.$o
else
GAMEOBJS+= $(SRC)/version.$o
EDITOROBJS+= $(SRC)/version.$o
endif

# TARGETS
.PHONY: clean veryclean all
ifeq ($(PLATFORM),EMSCRIPTEN)
all: wasm
include Makefile.emscripten
else
all: duke3d$(EXESUFFIX) build$(EXESUFFIX)
endif

# Browser tests (brief 02; they need scripts/build-wasm.sh and scripts/fetch-test-data.sh first, see
# doco/browser/building.md section 6.4). tests/web/firefox.js is optional and not run here.
.PHONY: test-web
test-web:
	node tests/web/smoke.js
	node tests/web/persist.js
	node tests/web/focus.js
	node tests/web/loops.js

include Makefile.deps

$(ENGINEROOT)/%:
	$(MAKE) -C $(@D) -f Makefile \
		USE_POLYMOST=$(USE_POLYMOST) \
		USE_OPENGL=$(USE_OPENGL) \
		USE_ASM=$(USE_ASM) \
		RELEASE=$(RELEASE) $(@F)

$(AUDIOLIBROOT)/%:
	$(MAKE) -C $(@D) \
		RELEASE=$(RELEASE) $(@F)

duke3d$(EXESUFFIX): $(GAMEOBJS) $(ENGINEROOT)/$(ENGINELIB) $(AUDIOLIBROOT)/$(JFAUDIOLIB)
	$(CXX) $(CPPFLAGS) $(OURCPPFLAGS) $(CXXFLAGS) $(OURCXXFLAGS) -o $@ $^ $(LDFLAGS) $(OURLDFLAGS)

build$(EXESUFFIX): $(EDITOROBJS) $(ENGINEROOT)/$(EDITORLIB) $(ENGINEROOT)/$(ENGINELIB)
	$(CXX) $(CPPFLAGS) $(OURCPPFLAGS) $(CXXFLAGS) $(OURCXXFLAGS) -o $@ $^ $(LDFLAGS) $(OURLDFLAGS)

# RULES
$(SRC)/%.$o: $(SRC)/%.c
	$(CC) $(CPPFLAGS) $(OURCPPFLAGS) $(CFLAGS) $(OURCFLAGS) -c $< -o $@

$(SRC)/%.$o: $(SRC)/%.m
	$(CC) $(CPPFLAGS) $(OURCPPFLAGS) $(CFLAGS) $(OURCFLAGS) -c $< -o $@

$(MACTROOT)/%.$o: $(MACTROOT)/%.c
	$(CC) $(CPPFLAGS) $(OURCPPFLAGS) $(CFLAGS) $(OURCFLAGS) -c $< -o $@

$(RSRC)/%.$o: $(RSRC)/%.c
	$(CC) $(CPPFLAGS) $(OURCPPFLAGS) $(CFLAGS) $(OURCFLAGS) -c $< -o $@

$(SRC)/%.$(res): $(SRC)/%.rc
	$(RC) -i $< -o $@ --include-dir=$(SRC) --include-dir=$(ENGINEINC)

$(RSRC)/%_gresource.c: $(RSRC)/%.gresource.xml
	glib-compile-resources --generate-source --manual-register --c-name=startgtk --target=$@ --sourcedir=$(RSRC) $<
$(RSRC)/%_gresource.h: $(RSRC)/%.gresource.xml
	glib-compile-resources --generate-header --manual-register --c-name=startgtk --target=$@ --sourcedir=$(RSRC) $<

$(RSRC)/%_bmp.c: $(RSRC)/%.bmp | $(ENGINEROOT)/bin2c$(EXESUFFIX)
	$(ENGINEROOT)/bin2c$(EXESUFFIX) $< appicon_bmp > $@
$(RSRC)/%.bmp: $(RSRC)/%.png
	$(shell which magick convert true | head -1) $< $@

# PHONIES
clean::
	-rm -f $(GAMEOBJS) $(EDITOROBJS)
veryclean:: clean
	-rm -f duke3d$(EXESUFFIX) build$(EXESUFFIX) core*

clean::
	$(MAKE) -C $(ENGINEROOT) $@
	$(MAKE) -C $(AUDIOLIBROOT) $@
veryclean::
	$(MAKE) -C $(ENGINEROOT) $@

.PHONY: $(SRC)/version-auto.c
$(SRC)/version-auto.c:
	printf "const char *game_version = \"%s\";\n" "$(shell git describe --always || echo git error)" > $@
	echo "const char *game_date = __DATE__;" >> $@
	echo "const char *game_time = __TIME__;" >> $@

# TESTS (brief 00: the tests of the scripts. Brief 01 adds the network tests; see
# doco/browser/building.md.) tests/fetch-test-data.sh downloads the two shareware zips
# unless JFDUKE3D_TEST_ZIP and JFDUKE3D_TEST_ZIP2 name local copies.
.PHONY: test test-scripts
test-scripts:
	tests/fetch-test-data.sh
	tests/run-headless.sh

test: test-scripts
