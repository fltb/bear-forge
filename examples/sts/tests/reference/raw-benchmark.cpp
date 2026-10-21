// Test-only raw reference timing. No JSON, IPC or public projection is executed
// inside the timed region; all transitions come from the pinned source.
#include <nlohmann/json.hpp>
#include <chrono>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <vector>
#include "game/GameContext.h"
#include "combat/BattleContext.h"
#include "sim/search/Action.h"
#include "sim/search/GameAction.h"
using namespace sts;
using Clock=std::chrono::steady_clock;
#ifdef STS_COUNT_WORK
extern "C" void __llvm_profile_reset_counters(void);
#endif
struct Move { bool battle; std::uint32_t bits; };
static int run(std::uint64_t seed,const std::vector<Move>& moves) {
    GameContext game(CharacterClass::IRONCLAD,seed,20);
    std::unique_ptr<BattleContext> battle;
    bool heart=false;
    const auto settle=[&] {
        while(game.outcome==GameOutcome::UNDECIDED&&game.screenState==ScreenState::BATTLE) {
            if(!battle){battle=std::make_unique<BattleContext>();battle->init(game);}
            if(battle->outcome==Outcome::UNDECIDED)break;
            heart|=battle->encounter==MonsterEncounter::THE_HEART&&battle->outcome==Outcome::PLAYER_VICTORY;
            battle->exitBattle(game);battle.reset();
        }
    };
    settle();
    for(const auto &move:moves){
        if(bool(battle)!=move.battle)throw std::runtime_error("Action kind mismatch");
        if(battle){search::Action action(move.bits);if(!action.isValidAction(*battle))throw std::runtime_error("Illegal battle action");action.execute(*battle);}
        else {search::GameAction action(move.bits);if(!action.isValidAction(game))throw std::runtime_error("Illegal game action");
            // Same documented upstream potion-helper defect as reference.cpp.
            if(action.isPotionAction()){if(action.isPotionDiscard())game.discardPotionAtIdx(action.getIdx1());else game.drinkPotionAtIdx(action.getIdx1());}
            else action.execute(game);
        }
        settle();
    }
    if(!heart||game.curHp<=0||game.outcome!=GameOutcome::PLAYER_VICTORY||!game.redKey||!game.greenKey||!game.blueKey)throw std::runtime_error("Incomplete Heart trajectory");
    return game.curHp;
}
int main(int argc,char **argv){
    try{
        if(argc!=2)throw std::runtime_error("Expected fixture path");
        std::ifstream input(argv[1]);nlohmann::json fixture;input>>fixture;
        const auto seed=std::stoull(fixture.at("seed").get<std::string>());
        std::vector<Move> moves;for(const auto &entry:fixture.at("actions"))moves.push_back({entry.at("kind")=="battle",entry.at("bits").get<std::uint32_t>()});
#ifdef STS_COUNT_WORK
        __llvm_profile_reset_counters();
        const int expected=run(seed,moves);if(fixture.contains("final")&&expected!=fixture.at("final").at("game").at("hp").get<int>())throw std::runtime_error("Final HP mismatch");
        std::cout<<nlohmann::json{{"runs",1},{"actions",moves.size()},{"hp",expected}}.dump()<<std::endl;
#else
        const int expected=run(seed,moves);if(fixture.contains("final")&&expected!=fixture.at("final").at("game").at("hp").get<int>())throw std::runtime_error("Final HP mismatch");std::uint64_t checksum=0;
        for(int batch=0;batch<7;batch++){
            const auto start=Clock::now();
            for(int index=0;index<10000;index++){const int hp=run(seed,moves);if(hp!=expected)throw std::runtime_error("Non-deterministic final HP");checksum+=hp+moves.size();}
            const double elapsed=std::chrono::duration<double,std::milli>(Clock::now()-start).count();
            std::cout<<nlohmann::json{{"batch",batch},{"runs",10000},{"msPerRun",elapsed/10000},{"actions",moves.size()},{"hp",expected},{"checksum",checksum}}.dump()<<std::endl;
        }
#endif
    }catch(const std::exception &error){std::cerr<<error.what()<<std::endl;return 1;}
}
