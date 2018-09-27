use actix_web;
use gu_base::{App, Arg, ArgMatches, Decorator, Module, SubCommand};
use plugins;
use plugins::rest::scope;
use std::path::PathBuf;

#[derive(Debug)]
pub struct PluginModule {
    command: Command,
}

#[derive(Debug, Clone)]
enum Command {
    None,
    List,
    Install(PathBuf),
    Dev(PathBuf),
    Uninstall(String),
}

impl PluginModule {
    pub fn new() -> Self {
        Self {
            command: Command::None,
        }
    }
}

impl Module for PluginModule {
    fn args_declare<'a, 'b>(&self, app: App<'a, 'b>) -> App<'a, 'b> {
        app.subcommand(SubCommand::with_name("plugin").subcommands(vec![
            SubCommand::with_name("install").arg(
                Arg::with_name("archive")
                    .takes_value(true)
                    .short("a")
                    .long("archive")
                    .help("specifies path to archive")
                    .required(true)
            ),

            SubCommand::with_name("dev").arg(
                Arg::with_name("dir")
                    .takes_value(true)
                    .short("d")
                    .long("dir-path")
                    .help("specifies path to plugin directory")
                    .required(true)
            ),

            SubCommand::with_name("list"),

            SubCommand::with_name("uninstall"),
        ]))
    }

    fn args_consume(&mut self, matches: &ArgMatches) -> bool {
        if let Some(m) = matches.subcommand_matches("plugin") {
            self.command = match m.subcommand() {
                ("list", Some(_)) => Command::List,
                ("install", Some(m)) => {
                    let tar_path = PathBuf::from(
                        m.value_of("archive")
                            .expect("Lack of required `archive` argument"),
                    );
                    Command::Install(tar_path)
                }
                ("dev", Some(m)) => {
                    let dir_path = PathBuf::from(
                        m.value_of("dir")
                            .expect("Lack of required `dir-path` argument"),
                    );
                    Command::Dev(dir_path)
                }
                ("uninstall", Some(m)) => {
                    let name = String::from(
                        m.value_of("name")
                            .expect("Lack of required `name` argument"),
                    );
                    Command::Uninstall(name)
                }
                ("", None) => Command::None,
                _ => return false,
            };
            true
        } else {
            false
        }
    }

    fn run<D: Decorator + Clone + 'static>(&self, _decorator: D) {
        match self.command {
            Command::None => (),
            Command::List => plugins::rest::list_query(),
            Command::Install(ref path) => plugins::rest::install_query(path),
            Command::Dev(ref path) => plugins::rest::dev_query(path.to_path_buf()),
            Command::Uninstall(ref name) => {}
        }
    }

    fn decorate_webapp<S: 'static>(&self, app: actix_web::App<S>) -> actix_web::App<S> {
        app.scope("/plug", scope)
    }
}
